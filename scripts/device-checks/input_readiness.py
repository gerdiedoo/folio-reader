"""Check Android's input service before injecting text into a focused editor."""
import re


def keyboard_ready(dump, package):
    shown = bool(re.search(r'\b(?:mInputShown|mIsInputViewShown|isInputViewShown)=true\b', dump))
    visibility = re.search(r'\bmImeWindowVis=(0x[0-9a-fA-F]+)', dump)
    if visibility:
        shown = shown or bool(int(visibility.group(1), 16) & 2)
    target = re.escape(package)
    belongs = bool(re.search(r'\bpackageName=[\"\']?' + target + r'(?![\w.])', dump) or
                   re.search(r'\bmCurFocusedWindow[^\n]*\b' + target + r'/', dump))
    connecting = bool(re.search(r'\bmServedConnecting=true\b', dump))
    return shown and belongs and not connecting
