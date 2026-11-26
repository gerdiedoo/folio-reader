"""Exercise the installed release APK through Android accessibility nodes.

Only a disposable CI emulator and synthetic Guest data are supported. Screenshots
and timing establish native execution; this does not emulate TalkBack or a phone.
"""
import json
import os
import pathlib
import re
import sqlite3
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from adb_session import ensure_emulator_root
from tap_geometry import exposed_book_point
PACKAGE=os.environ.get('FOLIO_ANDROID_PACKAGE','com.folio.reader.dev')
if PACKAGE not in ['com.folio.reader','com.folio.reader.dev']:
    raise ValueError('Only Folio packages on the disposable CI emulator are supported')
OUT=pathlib.Path(os.environ.get('FOLIO_ANDROID_EVIDENCE','/tmp/folio-android-evidence'));OUT.mkdir(parents=True,exist_ok=True)
def adb(*args,check=True):
    return subprocess.run(['adb',*args],check=check,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=40).stdout

def nodes():
    adb('shell','uiautomator','dump','/data/local/tmp/folio-window.xml')
    raw=adb('exec-out','cat','/data/local/tmp/folio-window.xml')
    (OUT/'last-window.xml').write_bytes(raw)
    return list(ET.fromstring(raw).iter('node'))

def find(label,timeout=25,contains=False):
    until=time.monotonic()+timeout
    while time.monotonic()<until:
        try:
            for node in nodes():
                values=[node.get('content-desc',''),node.get('text','')]
                if any(label in v if contains else label==v for v in values) and node.get('enabled')!='false':
                    return node
        except (ET.ParseError,subprocess.SubprocessError): pass
        time.sleep(.5)
    raise AssertionError('Visible accessible action missing: '+label)

def tap_node(node):
    box=list(map(int,re.findall(r'\d+',node.get('bounds',''))));assert len(box)==4
    adb('shell','input','tap',str((box[0]+box[2])//2),str((box[1]+box[3])//2))
    time.sleep(.4)

def tap(label,**kwargs): tap_node(find(label,**kwargs))
def reveal_library_book(label):
    # Accessibility bounds can include a cover underneath the floating tabs.
    # Scroll it clear of that overlay before choosing a physical tap coordinate.
    size=adb('shell','wm','size').decode()
    width,height=map(int,re.findall(r'(\d+)x(\d+)',size)[-1])
    for _ in range(5):
        node=find(label,contains=True)
        box=list(map(int,re.findall(r'\d+',node.get('bounds',''))))
        tabs=[list(map(int,re.findall(r'\d+',item.get('bounds','')))) for item in nodes()
              if item.get('content-desc') in ['Library','Reading','Notebook','Settings']]
        tab_top=min((bounds[1] for bounds in tabs if len(bounds)==4 and bounds[1]>height*.5),default=None)
        point=exposed_book_point(box,width,height,tab_top) if len(box)==4 else None
        if point:
            return point
        adb('shell','input','swipe',str(width//2),str(int(height*.70)),
            str(width//2),str(int(height*.35)),'500')
        time.sleep(.5)
    raise AssertionError(f'Imported Library book has no exposed tap point: bounds={box}, tabs={tab_top}, screen={width}x{height}')
def screenshot(name): (OUT/(name+'.png')).write_bytes(adb('exec-out','screencap','-p'))
def launch():
    result=adb('shell','am','start','-W','-n',PACKAGE+'/.MainActivity')
    with (OUT/'launch-timing.txt').open('ab') as f:f.write(result+b'\n')

def library_record(expected_bookmark=None):
    # The emulator contains only the generated fixture; no account is signed in.
    dbdir=OUT/'synthetic-state';dbdir.mkdir(exist_ok=True)
    for name in ['RKStorage','RKStorage-wal','RKStorage-shm']:
        result=subprocess.run(['adb','pull',f'/data/data/{PACKAGE}/databases/{name}',str(dbdir/name)],capture_output=True,timeout=20)
        if result.returncode and name=='RKStorage': raise AssertionError('Native persisted Guest database not readable')
    c=sqlite3.connect(dbdir/'RKStorage')
    try:
        entries=list(c.execute('select key,value from catalystLocalStorage'))
        for key,value in entries:
            if key.endswith('.libraryArchive') or key.endswith(':libraryArchive'):
                archive=json.loads(value)
                book=next((b for b in archive.get('books',[]) if b['title']=='Folio device journey'),None)
                if book:
                    if expected_bookmark:
                        saved=[item for k,v in entries if k.endswith('.bookmarks') for item in json.loads(v)]
                        assert any(item.get('bookId')==expected_bookmark for item in saved), 'Saved bookmark did not survive process restart'
                    return book
    finally:c.close()
    raise AssertionError('Imported book is absent from acknowledged native storage')

def pause_snapshot(expected_bookmark=None):
    adb('shell','input','keyevent','KEYCODE_HOME');time.sleep(1.5)
    return library_record(expected_bookmark)

def focused_field(label,timeout=12):
    # Seeing the view in the hierarchy does not mean Android has finished its
    # input-focus handoff. Do not inject keys into a not-yet-focused window.
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        node=find(label,timeout=3)
        if node.get('focused')=='true':return node
        time.sleep(.3)
    raise AssertionError('Search input did not receive native focus: '+json.dumps(node.attrib))

def check_library_search():
    field='Search Library by title or author'
    book='Folio device journey by Folio test fixture.'
    tap('Search Library');tap(field);focused_field(field)
    adb('shell','input','text','Folio');time.sleep(.4)
    initial=find(field)
    assert initial.get('text')=='Folio', 'Library input lost the typed title: '+json.dumps(initial.attrib)
    adb('shell','input','text','%sdevice');time.sleep(.4)
    assert find(field).get('text')=='Folio device', 'Library input lost focus between keystrokes'
    find(book,contains=True)
    tap('Clear Library search');adb('shell','input','text','zzzzmissingbook');time.sleep(.4)
    find('No books match this search and filter. Try another title or author.')
    tap('Clear Library search');adb('shell','input','text','Folio%stest%sfixture');time.sleep(.4)
    normal=list(map(int,re.findall(r'\d+',find(book,contains=True).get('bounds',''))))
    tap('3-column grid')
    dense=list(map(int,re.findall(r'\d+',find(book,contains=True).get('bounds',''))))
    assert dense[2]-dense[0]<normal[2]-normal[0], 'Three columns did not make Library cards smaller'
    assert find(field).get('text')=='Folio test fixture', 'Changing columns reset the author search'
    screenshot('02b-library-search-three-columns')
    tap('2-column grid');tap('Hide Library search')

def check_free_books_controls():
    tap('Browse free books')
    field='Search free books by title or author'
    tap(field);focused_field(field);adb('shell','input','text','shelley');time.sleep(.4)
    tap('3-column grid')
    assert find(field).get('text')=='shelley', 'Changing free-book columns reset the search'
    screenshot('02c-free-books-layout')
    tap('2-column grid');tap('Back to library')

def tap_google_books_source():
    size=adb('shell','wm','size').decode()
    width,height=map(int,re.findall(r'(\d+)x(\d+)',size)[-1])
    first=find('Project Gutenberg')
    box=list(map(int,re.findall(r'\d+',first.get('bounds',''))));y=(box[1]+box[3])//2
    for _ in range(5):
        try:
            target=find('Google Books',timeout=2)
            bounds=list(map(int,re.findall(r'\d+',target.get('bounds',''))))
            if len(bounds)==4 and bounds[2]-bounds[0]>30 and 0<(bounds[0]+bounds[2])//2<width:
                tap_node(target);return
        except AssertionError:pass
        adb('shell','input','swipe',str(int(width*.85)),str(y),str(int(width*.15)),str(y),'350');time.sleep(.4)
    raise AssertionError('Google Books source chip was not reachable')

def check_google_books_key():
    # This is a synthetic, nonfunctional key. The test does not authenticate
    # with Google or claim successful provider search/download behavior.
    tap('Browse free books');tap_google_books_source();tap('Google Books setup')
    field='Google Books API key';tap(field);focused_field(field)
    adb('shell','input','text','folio-test-key-01234567890123456789')
    adb('shell','input','keyevent','KEYCODE_BACK');tap('Save Google Books key')
    find('Google Books key saved',contains=True);tap('Back to library')
    adb('shell','am','force-stop',PACKAGE);launch();find('Folio Library')
    tap('Browse free books');tap_google_books_source();tap('Google Books setup')
    find('A key is saved on this device.',contains=True)
    screenshot('02d-google-books-key-after-restart')
    tap('Remove Google Books key');find('Connect Google Books')
    screenshot('02e-google-books-key-removed');tap('Back to library')

def run():
    ensure_emulator_root()
    launch();find('Folio Library',timeout=60)
    summary=[find(label) for label in ['Today’s reading','0 day streak','0 books finished this year']]
    boxes=[list(map(int,re.findall(r'\d+',node.get('bounds','')))) for node in summary]
    assert all(len(box)==4 for box in boxes), 'Reading summary has no measured native bounds'
    title,streak,finished=boxes
    assert title[0]<streak[0]<finished[0], 'Reading summary counters must sit to the right of the reading time'
    assert all(min(title[3],box[3])>max(title[1],box[1]) for box in [streak,finished]), 'Reading summary is not a compact single row'
    (OUT/'reading-summary-layout.json').write_text(json.dumps({'fontScale':1,'title':title,'streak':streak,'finished':finished},indent=2))
    tap('Library bookmarks, 0 saved');find('No bookmarks yet.');tap('Close bookmarks')
    screenshot('01-empty-library')
    adb('shell','settings','put','system','font_scale','1.5');time.sleep(1)
    find('Today’s reading');find('0 books finished this year');screenshot('01b-large-text-reading-summary')
    adb('shell','settings','put','system','font_scale','1.0');time.sleep(1)
    tap('Import EPUB')
    # Recent files often already contains the pushed EPUB. Only navigate roots
    # if it is not visible; Android DocumentsUI varies across system images.
    try:tap('folio-device-journey.epub',timeout=4)
    except AssertionError:
        try:tap('Show roots',timeout=3)
        except AssertionError:
            try:tap('Show navigation drawer',timeout=3)
            except AssertionError:pass
        tap('Downloads')
        tap('folio-device-journey.epub')
    find('Folio device journey by Folio test fixture.',contains=True,timeout=45)
    check_library_search()
    check_free_books_controls()
    check_google_books_key()
    book_point=reveal_library_book('Folio device journey by Folio test fixture.')
    screenshot('02-imported-library')
    adb('shell','input','tap',*map(str,book_point));time.sleep(.4)
    tap('Read Folio device journey')
    find('Scroll reading mode');find('Circle on warm paper');screenshot('03-rich-reader')
    tap('Save bookmark for this passage')
    find('Remove bookmark from this passage')
    # A real native list scroll produces a source word anchor plus same-layout pixels.
    adb('shell','input','swipe','500','1700','500','650','700');time.sleep(1)
    before=pause_snapshot();assert before.get('readingPosition',{}).get('anchor'), 'Scroll did not persist an edition-specific source anchor'
    launch();tap('Back to Library');tap('Resume Folio device journey by Folio test fixture')
    find('Scroll reading mode');screenshot('04-reopened-reader')
    reopened=pause_snapshot()
    assert before['readingPosition']==reopened['readingPosition'], 'Closing and reopening rewound the saved source position'
    adb('shell','am','force-stop',PACKAGE);launch();find('Folio Library')
    tap('Resume Folio device journey by Folio test fixture');find('Scroll reading mode');screenshot('05-process-restart')
    restarted=pause_snapshot(before['id']);assert reopened['readingPosition']==restarted['readingPosition'], 'Restart changed the saved source position'
    launch();tap('Back to Library');tap('Notebook');tap('New quote');tap('Quote text')
    adb('shell','input','text','A%ssynthetic%sreflection');tap('Quote reflection');adb('shell','input','text','Return%sto%sthe%ssource')
    adb('shell','input','keyevent','KEYCODE_BACK');tap('Save new highlight')
    find('A synthetic reflection',contains=True);screenshot('06-saved-reflection')
    adb('shell','settings','put','system','font_scale','1.5');time.sleep(1)
    screenshot('07-large-text-notebook')
    adb('shell','settings','put','system','font_scale','1.0')
    adb('shell','am','force-stop',PACKAGE);launch();find('Folio Library');tap('Notebook');find('A synthetic reflection',contains=True)
    screenshot('08-reflection-after-restart')
    tap('Search Archive');tap('Search saved books, quotes, notes and vocabulary')
    adb('shell','input','text','Folio');time.sleep(.4)
    find('Open book details for Folio device journey by Folio test fixture')
    screenshot('09-archive-search-results')
    tap('Open book details for Folio device journey by Folio test fixture');find('Read Folio device journey')
    (OUT/'result.json').write_text(json.dumps({'passed':True,'checks':['combined Library reading summary and large-text capture','Library bookmark chip opens saved passages','native import','Library title/author search and typing focus','Library missing-result recovery','two/three-column grid with search retained','free-books search and column controls','encrypted synthetic Google Books key save, process restart and removal','rich reader render','bookmark persistence control','scroll close/reopen position','process restart position','reflection creation and restart','large text rendering capture','global archive book results and navigation'],'talkback':'requires phone testing','book':before['id']},indent=2))
try:run()
except Exception as error:
    try:
        snapshot=nodes()
        labels=[node.get('content-desc') or node.get('text') for node in snapshot]
        inputs=[node.attrib for node in snapshot if node.get('class','').endswith('EditText')]
        runtime=adb('logcat','-d','-v','brief','ReactNativeJS:V','AndroidRuntime:E','*:S',check=False).decode(errors='replace')[-2200:]
        message=json.dumps({'error':str(error),'inputs':inputs,'runtime':runtime,'visible':[label for label in labels if label]},ensure_ascii=True)[:3800]
        print('::error title=Android reading journey failed::'+message.replace('%','%25').replace('\r','%0D').replace('\n','%0A'),flush=True)
    except Exception:pass
    try:screenshot('failure')
    except Exception:pass
    raise
finally:
    (OUT/'logcat.txt').write_bytes(adb('logcat','-d','-t','2000',check=False))
    # Raw Guest SQLite is diagnostic input only; publish the results and screens.
    import shutil
    shutil.rmtree(OUT/'synthetic-state',ignore_errors=True)
