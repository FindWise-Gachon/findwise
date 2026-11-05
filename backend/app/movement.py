"""Shared eight-neighbor movement policy for reviewed access arrays."""
import numbers

def can_move(access, start, destination, *, allow_unknown):
    if access.ndim != 2 or type(allow_unknown) is not bool:
        raise ValueError("A 2D access array and explicit boolean unknown policy are required")
    if any(len(point) != 2 or any(isinstance(v, bool) or not isinstance(v, numbers.Integral) for v in point)
           for point in (start, destination)):
        raise ValueError("Positions must be integer row/column pairs")
    row, column = start
    next_row, next_column = destination
    if max(abs(next_row - row), abs(next_column - column)) > 1:
        return False

    def passable(r, c):
        if not (0 <= r < access.shape[0] and 0 <= c < access.shape[1]):
            return False
        value = access[r, c]
        if value not in (0, 1, 2):
            raise ValueError("Unknown access code")
        return value == 1 or (value == 0 and allow_unknown)

    if not passable(row, column) or not passable(next_row, next_column):
        return False
    if row != next_row and column != next_column:
        # Both side cells must be traversable. A shared corner is not a passage.
        return bool(passable(row, next_column) and passable(next_row, column))
    return True
