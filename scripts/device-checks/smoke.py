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
PACKAGE='com.folio.reader.dev'
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
        if len(box)==4 and box[1]>=height*.18 and box[3]<=height*.75:
            return node
        adb('shell','input','swipe',str(width//2),str(int(height*.70)),
            str(width//2),str(int(height*.35)),'500')
        time.sleep(.5)
    raise AssertionError('Imported Library book could not be scrolled clear of navigation')
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

def run():
    ensure_emulator_root()
    launch();find('Folio Library',timeout=60);screenshot('01-empty-library')
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
    book_node=reveal_library_book('Folio device journey by Folio test fixture.')
    screenshot('02-imported-library')
    tap_node(book_node)
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
    (OUT/'result.json').write_text(json.dumps({'passed':True,'checks':['native import','rich reader render','bookmark persistence control','scroll close/reopen position','process restart position','reflection creation and restart','large text rendering capture'],'talkback':'requires phone testing','book':before['id']},indent=2))
try:run()
except Exception as error:
    try:
        labels=[node.get('content-desc') or node.get('text') for node in nodes()]
        runtime=adb('logcat','-d','-v','brief','ReactNativeJS:V','AndroidRuntime:E','*:S',check=False).decode(errors='replace')[-2200:]
        message=json.dumps({'error':str(error),'runtime':runtime,'visible':[label for label in labels if label]},ensure_ascii=True)[:3800]
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
