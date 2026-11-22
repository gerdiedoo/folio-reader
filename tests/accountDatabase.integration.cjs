const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, execFile } = require('node:child_process');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const tables = ['books', 'highlights', 'lexicon', 'reading_goals', 'reading_settings'];
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/202611200001_account_isolation.sql'), 'utf8');

test('PostgreSQL account isolation, migration and legacy preservation', { timeout: 180000 }, async t => {
  const container = `folio-account-test-${process.pid}-${Date.now()}`;
  const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const sql = input => process.env.FOLIO_TEST_SQL_DRIVER ? execFileSync(process.execPath, [process.env.FOLIO_TEST_SQL_DRIVER], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }) : execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const role = (id, body) => `set role authenticated; select set_config('request.jwt.claim.sub', '${id}', false);\n${body}\nreset role;`;
  const denied = statement => `do $test$ begin begin ${statement}; raise exception 'Expected permission denial'; exception when insufficient_privilege then null; end; end $test$;`;
  const check = (expression, label) => `do $test$ begin if not (${expression}) then raise exception '${label}'; end if; end $test$;`;
  let created = false;
  try {
    if (!process.env.FOLIO_TEST_SQL_DRIVER) {
    docker('run', '--name', container, '--network', 'none', '-e', 'POSTGRES_PASSWORD=local-test-only', '-d', 'postgres:17-alpine');
    created = true;
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      try {
        // pg_isready can succeed against the image's temporary init server.
        // Wait until init finishes, then require the final server to be ready.
        const logs = docker('logs', container);
        if (!logs.includes('PostgreSQL init process complete; ready for start up.')) throw new Error('Still initializing');
        docker('exec', container, 'pg_isready', '-U', 'postgres'); ready = true; break;
      }
      catch { await new Promise(resolve => setTimeout(resolve, 200)); }
    }
    assert.ok(ready, `PostgreSQL must be ready after initialization. ${ready ? '' : docker('logs', container).slice(-3000)}`);
    }
    sql(`do $$ begin if not exists(select from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;
      create schema auth; create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      insert into auth.users values ('${A}'), ('${B}');`);
    sql(fs.readFileSync(path.join(root, 'tests/fixtures/legacy-shared-schema.sql'), 'utf8'));
    sql(`insert into public.books(id,title,author) values ('legacy','Legacy book','Test author');
      insert into public.highlights(id,book_id,book_title,text) values ('legacy','legacy','Legacy book','Keep this note');
      insert into public.lexicon(id,word,definition) values ('legacy','keep','Preserved');
      insert into public.reading_goals(id) values ('legacy');
      insert into public.reading_settings(id) values ('legacy');`);
    await t.test('canonical schema matches the migration and applies twice without deleting shared records', () => {
      assert.equal(fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8'), migration);
      sql(migration); sql(migration);
      for (const table of tables) sql(check(`(select count(*) = 1 from public.${table})`, `Lost legacy ${table}`));
    });
    await t.test('two accounts can store the same local IDs independently in every private table', () => {
      for (const id of [A, B]) sql(role(id, `
        insert into public.folio_books(id,title,author) values ('same','Private book','Test author');
        insert into public.folio_highlights(id,book_id,book_title,text) values ('same','same','Private book','Private note');
        insert into public.folio_lexicon(id,word,definition) values ('same','word','Private definition');
        insert into public.folio_reading_goals(id) values ('same');
        insert into public.folio_reading_settings(id) values ('same');
        insert into public.library_backups(user_id,books) values ('${id}','[]');`));
      for (const id of [A, B]) for (const table of tables) sql(role(id, check(`(select count(*) = 1 and bool_and(user_id = '${id}') from public.folio_${table})`, `Cross-account read ${table}`)));
    });
    await t.test('forged ownership, cross-account updates and deletion are blocked', () => {
      for (const table of tables) {
        const values = table === 'books' ? "id,title,author) values ('forged','x','x'" : table === 'highlights' ? "id,book_id,book_title,text) values ('forged','x','x','x'" : table === 'lexicon' ? "id,word,definition) values ('forged','x','x'" : "id) values ('forged'";
        const [columns, tuple] = values.split(') values (');
        sql(role(B, denied(`insert into public.folio_${table}(user_id,${columns}) values ('${A}',${tuple})`)));
        sql(role(B, denied(`update public.folio_${table} set user_id = '${A}' where id = 'same'`)));
        sql(role(B, `update public.folio_${table} set id='changed' where user_id='${A}'; delete from public.folio_${table} where user_id='${A}';`));
        sql(check(`(select count(*) = 1 from public.folio_${table} where user_id='${A}' and id='same')`, `Other account altered ${table}`));
      }
      sql(role(B, denied(`insert into public.library_backups(user_id,books) values ('${A}','[]') on conflict(user_id) do update set books=excluded.books`)));
      sql(role(B, check(`(select count(*)=1 and bool_and(user_id='${B}') from public.library_backups)`, 'Backup visibility leaked')));
    });
    await t.test('account backup upsert returns its owner and restores the exact JSON without crossing accounts', () => {
      const books = [{ title: 'Backup edition', author: 'Test author', gutenbergId: 1342, currentPage: 3, progressPercent: 32 }];
      const encoded = JSON.stringify(books);
      sql(role(A, `insert into public.library_backups(user_id,books) values ('${A}','${encoded}') on conflict(user_id) do update set books=excluded.books returning user_id;`));
      sql(role(A, check(`(select books='${encoded}'::jsonb from public.library_backups where user_id='${A}')`, 'Backup did not round-trip')));
      sql(role(B, check(`(select books='[]'::jsonb from public.library_backups where user_id='${B}')`, 'Other account backup was altered')));
    });
    await t.test('anonymous clients and authenticated clients cannot read quarantined shared tables', () => {
      for (const table of [...tables, ...tables.map(name => 'folio_' + name), 'library_backups']) sql(`set role anon; ${denied(`select * from public.${table}`)} reset role;`);
      for (const table of tables) sql(role(A, denied(`select * from public.${table}`)));
    });
    await t.test('anonymous writes and authenticated TRUNCATE cannot bypass row ownership', () => {
      sql(`set role anon; ${denied("insert into public.folio_books(user_id,id,title,author) values ('"+A+"','forged','x','x')")} reset role;`);
      sql(role(B, denied('truncate public.folio_books')));
    });
    await t.test('a broad additional permissive policy cannot bypass the owner boundary', () => {
      sql('create policy test_open on public.folio_books for all to authenticated using(true) with check(true);');
      sql(role(B, check(`(select count(*)=1 and bool_and(user_id='${B}') from public.folio_books)`, 'Permissive policy bypassed boundary')));
      sql(role(B, denied(`insert into public.folio_books(user_id,id,title,author) values ('${A}','forged','x','x')`)));
    });
    await t.test('migration reruns preserve private data and owners can delete only their rows', () => {
      sql(migration);
      for (const table of tables) sql(check(`(select count(*)=2 from public.folio_${table})`, `Private rows lost ${table}`));
      sql(role(A, "delete from public.folio_books where id='same';"));
      sql(check(`(select count(*)=1 and bool_and(user_id='${B}') from public.folio_books)`, 'Owner deletion crossed accounts'));
    });
    await t.test('deleting an auth account cascades only its private data', () => {
      sql(`delete from auth.users where id='${A}';`);
      for (const table of tables) sql(check(`(select count(*)=1 and bool_and(user_id='${B}') from public.folio_${table})`, `Account deletion crossed ${table}`));
      for (const table of tables) sql(check(`(select count(*)=1 from public.${table})`, `Legacy record removed ${table}`));
    });
    await t.test('revision protocol enforces ownership, compare-and-swap, retry identity and persistent deletion', () => {
      sql(`insert into auth.users values ('${A}');`);
      const revisionMigration = fs.readFileSync(path.join(root,'supabase/migrations/202611210001_revision_sync.sql'),'utf8');
      sql(revisionMigration); sql(revisionMigration);
      const write = (owner, kind, id, payload, revision, token) => `public.folio_write_record('${owner}','${kind}','${id}',${payload === null ? 'null' : "'"+JSON.stringify(payload).replaceAll("'","''")+"'::jsonb"},${revision},'00000000-1111-4000-8000-${String(token).padStart(12,'0')}')`;
      const book={id:'reader-book',title:'Test edition',author:'Author',coverUrl:'',progressPercent:0,currentPage:1,totalPages:2};
      const first=write(A,'book',book.id,book,0,1);
      sql(role(A,check(`(${first}->>'accepted')::boolean`,'Initial revision rejected')));
      sql(role(A,check(`(${first}->'record'->>'revision')::int=1`,'Retry duplicated revision')));
      sql(role(A,check(`not (${write(A,'book',book.id,{...book,title:'Stale'},0,2)}->>'accepted')::boolean`,'Stale revision overwrote')));
      sql(role(A,denied(`select ${write(B,'book','forged', {...book,id:'forged'},0,3)}`)));
      sql(role(B,check(`(select count(*)=0 from public.folio_records where id='reader-book')`,'Revision visibility crossed accounts')));
      sql(role(B,denied(`update public.folio_records set payload=null where id='reader-book'`)));
      sql(`set role anon; ${denied(`select ${first}`)} reset role;`);
      const note={id:'note',bookId:book.id,bookTitle:book.title,text:'Original note',chapter:'Start',page:1,colorName:'Amber Crayon',colorHex:'#F8E8A2',dateAdded:''};
      sql(role(A,check(`(${write(A,'highlight','note',note,0,4)}->>'accepted')::boolean`,'Note rejected')));
      sql(role(A,check(`(${write(A,'book',book.id,null,1,5)}->>'accepted')::boolean`,'Removal rejected')));
      sql(role(A,check(`(select payload is null and revision=2 from public.folio_records where kind='highlight' and id='note')`,'Child removal not retained')));
      sql(role(A,check(`not (${write(A,'highlight','offline-note',{...note,id:'offline-note'},0,6)}->>'accepted')::boolean`,'Stale child recreated')));
      sql(role(A,check(`not (${write(A,'book',book.id,book,1,7)}->>'accepted')::boolean`,'Stale book resurrected')));
      sql(revisionMigration);
      sql(role(A,check(`(select payload is null from public.folio_records where kind='book' and id='reader-book')`,'Migration resurrected removal')));
      sql(role(A,check(`(select count(*)=count(distinct change_id) from public.folio_records)`,'Change cursor duplicated')));
      sql(role(A,denied(`insert into public.folio_books(id,title,author) values ('bypass','x','x')`)));
    });
    await t.test('simultaneous writes to a new record accept exactly one base revision',async()=>{
      const run = input => new Promise((resolve,reject)=>{ const child=execFile(process.env.FOLIO_TEST_SQL_DRIVER ? process.execPath : 'docker',process.env.FOLIO_TEST_SQL_DRIVER ? [process.env.FOLIO_TEST_SQL_DRIVER] : ['exec','-i',container,'psql','-X','-q','-U','postgres','-v','ON_ERROR_STOP=1'],{encoding:'utf8'},(error,stdout)=>error?reject(error):resolve(stdout));child.stdin.end(input); });
      const outputs=await Promise.all([1,2].map(token=>run(`begin; ${role(A,`select public.folio_write_record('${A}','book','race','{"id":"race","title":"Concurrent","author":"Test"}',0,'11111111-1111-4111-8111-00000000000${token}'); select pg_sleep(0.2);`)} commit;`)));
      assert.equal(outputs.filter(value=>/"accepted"\s*:\s*true/.test(value)).length,1);
      assert.equal(outputs.filter(value=>/"accepted"\s*:\s*false/.test(value)).length,1);
      sql(check("(select revision=1 from public.folio_records where kind='book' and id='race')",'Competing writes advanced the same base twice'));
    });
  } finally {
    try { if (created) docker('rm', '-f', container); } catch { /* Nothing created or already removed. */ }
  }
});
