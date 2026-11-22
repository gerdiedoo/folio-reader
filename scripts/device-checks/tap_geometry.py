"""Find an exposed tap point in a book card partially behind floating tabs."""
def exposed_book_point(bounds, width, height, tab_top=None):
    left, top, right, bottom = bounds
    visible_top = max(top, int(height * .18))
    visible_bottom = min(bottom, tab_top - 12 if tab_top is not None else int(height * .9))
    left, right = max(0, left), min(width, right)
    if visible_bottom - visible_top < 24 or right <= left:
        return None
    return ((left + right) // 2, visible_top + min(40, (visible_bottom - visible_top) // 2))
