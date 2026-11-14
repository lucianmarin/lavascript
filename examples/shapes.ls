# Interfaces, classes, enums, comprehensions, and switch/case in LavaScript

enum ShapeKind:
    Circle = 0
    Rectangle = 1

interface Vec2:
    x: num
    y: num

class Shape:
    kind: ShapeKind
    origin: Vec2
    width: num
    height: num

    def __init__(self, kind: ShapeKind, width: num, height: num):
        self.kind = kind
        self.origin = { x: 0.0, y: 0.0 }
        self.width = width
        self.height = height

    def area(self) -> num:
        switch self.kind:
            case ShapeKind.Circle:
                return 3.141592653589793 * self.width * self.width
            case ShapeKind.Rectangle:
                return self.width * self.height
            default:
                return 0.0

def main() -> num:
    radii: list[num] = [num(i + 1) * 2.5 for i in range(3)]
    for r in radii:
        c: Shape = new Shape(ShapeKind.Circle, r, r)
        print(f"Circle area (r={r.toFixed(1)}): {c.area().toFixed(4)}")
    return 0

main()
