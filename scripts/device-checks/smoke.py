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
PACKAGE='com.folio.reader.dev'
OUT=pathlib.Path(os.environ.get('FOLIO_ANDROID_EVIDENCE','/tmp/folio-android-evidence'));OUT.mkdir(parents=True,exist_ok=True)
def adb(*args,check=True):
    return subprocess.run(['adb',*args],check=check,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=40).stdout

def nodes():
    adb('shell','uiautomator','dump','/sdcard/folio-window.xml')
    raw=adb('exec-out','cat','/sdcard/folio-window.xml')
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
def screenshot(name): (OUT/(name+'.png')).write_bytes(adb('exec-out','screencap','-p'))
def launch():
    result=adb('shell','am','start','-W','-n',PACKAGE+'/.MainActivity')
    with (OUT/'launch-timing.txt').open('ab') as f:f.write(result+b'\n')

def library_record():
    # The emulator contains only the generated fixture; no account is signed in.
    dbdir=OUT/'synthetic-state';dbdir.mkdir(exist_ok=True)
    for name in ['RKStorage','RKStorage-wal','RKStorage-shm']:
        result=subprocess.run(['adb','pull',f'/data/data/{PACKAGE}/databases/{name}',str(dbdir/name)],capture_output=True,timeout=20)
        if result.returncode and name=='RKStorage': raise AssertionError('Native persisted Guest database not readable')
    c=sqlite3.connect(dbdir/'RKStorage')
    try:
        for key,value in c.execute('select key,value from catalystLocalStorage'):
            if key.endswith('.libraryArchive') or key.endswith(':libraryArchive'):
                archive=json.loads(value)
                book=next((b for b in archive.get('books',[]) if b['title']=='Folio device journey'),None)
                if book:return book
    finally:c.close()
    raise AssertionError('Imported book is absent from acknowledged native storage')

def pause_snapshot():
    adb('shell','input','keyevent','KEYCODE_HOME');time.sleep(1.5)
    return library_record()

def run():
    adb('root');adb('wait-for-device')
    launch();find('Folio Library',timeout=60);screenshot('01-empty-library')
    tap('Import EPUB')
    # DocumentsUI differs by system image; use its actual navigation affordance.
    try:tap('Show roots',timeout=3)
    except AssertionError:
        try:tap('Show navigation drawer',timeout=3)
        except AssertionError:pass
    tap('Downloads',contains=True)
    tap('folio-device-journey.epub',contains=True)
    find('Folio device journey by Folio test fixture.',contains=True,timeout=45)
    screenshot('02-imported-library')
    tap('Folio device journey by Folio test fixture.',contains=True)
    tap('Read Folio device journey')
    find('Scroll reading mode');screenshot('03-rich-reader')
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
    restarted=pause_snapshot();assert reopened['readingPosition']==restarted['readingPosition'], 'Restart changed the saved source position'
    launch();tap('Back to Library');tap('Notebook');tap('New quote');tap('Quote text')
    adb('shell','input','text','A%ssynthetic%sreflection');tap('Quote reflection');adb('shell','input','text','Return%sto%sthe%ssource')
    adb('shell','input','keyevent','KEYCODE_BACK');tap('Save new highlight')
    find('A synthetic reflection',contains=True);screenshot('06-saved-reflection')
    adb('shell','settings','put','system','font_scale','1.5');time.sleep(1)
    screenshot('07-large-text-notebook')
    adb('shell','settings','put','system','font_scale','1.0')
    (OUT/'result.json').write_text(json.dumps({'passed':True,'checks':['native import','rich reader render','bookmark persistence control','scroll close/reopen position','process restart position','reflection creation','large text rendering capture'],'talkback':'requires phone testing','book':before['id']},indent=2))
try:run()
except Exception:
    try:screenshot('failure')
    except Exception:pass
    raise
finally:
    (OUT/'logcat.txt').write_bytes(adb('logcat','-d','-t','2000',check=False))
    # Raw Guest SQLite is diagnostic input only; publish the results and screens.
    import shutil
    shutil.rmtree(OUT/'synthetic-state',ignore_errors=True)
