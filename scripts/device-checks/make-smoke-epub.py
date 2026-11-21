"""Deterministic, copyright-free native import fixture with rich content and references."""
import base64
import html
import pathlib
import sys
import zipfile
out=pathlib.Path(sys.argv[1]);out.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
    z.writestr('mimetype','application/epub+zip',compress_type=zipfile.ZIP_STORED)
    z.writestr('META-INF/container.xml','<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
    z.writestr('EPUB/content.opf','''<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">folio-native-smoke</dc:identifier><dc:title>Folio device journey</dc:title><dc:creator>Folio test fixture</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="body" href="body.xhtml" media-type="application/xhtml+xml"/><item id="art" href="art.svg" media-type="image/svg+xml"/></manifest><spine><itemref idref="body"/></spine></package>''')
    z.writestr('EPUB/art.svg','<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120"><rect width="240" height="120" fill="#ece2d0"/><circle cx="120" cy="60" r="40" fill="#917052"/></svg>')
    paragraphs=''.join(f'<p id="p{i}">Passage {i}. '+html.escape('Reading should preserve every word and return to the same place. A reflection connects an idea with its original context. '*7)+'</p>' for i in range(1,41))
    z.writestr('EPUB/body.xhtml','<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Trust the passage</title></head><body><h1>Trust the passage</h1><p>Yes.</p><p>A <em>quiet</em> reader keeps <strong>every word</strong>. <a href="#note">Read the footnote</a>.</p><img src="art.svg" alt="Circle on warm paper"/><ol><li>Keep short dialogue.</li><li>Keep illustrations.</li></ol>'+paragraphs+'<aside id="note"><p>Footnote: a saved thought needs its original context.</p></aside><p>THE END.</p></body></html>')
