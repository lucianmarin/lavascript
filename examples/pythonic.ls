# Pythonic ergonomics in LavaScript: lambda, enumerate(), zip(), reversed(), f-strings,
# ternary, membership (`in` / `not in`), `//`, `**`, chained comparisons, and multi-line syntax

def main() -> num:
    banner: str = """=== Pythonic LavaScript ===
lambda, enumerate, zip, reversed"""

    # Multi-line nested comprehension
    nums: list[num] = [
        x * 10 + y
        for x in range(1, 4)
        for y in range(2)
        if x + y > 1
    ]

    # Inline lambda + negative indexing + ternary
    inc = lambda v: num -> num: v + 1
    tag: str = "big" if nums[-1] > 20 else "small"

    # Chained comparisons, `not` precedence, `is not`, `//`, `**`
    ok: bool = 0 < nums[0] < 50 and not 1 == 2 and tag is not nil
    fdiv: num = -7 // 2
    power: num = 2 ** 3

    # Set/dict membership (`in` / `not in`) + tuple unpacking
    seen: set[num] = {n for n in nums}
    weights: dict[num, num] = {n: inc(n) for n in nums}
    has_20: bool = 20 in seen and 99 not in seen
    a, b = 10, 20
    a, b = b, a

    print(banner)
    print(f"tag={tag} ok={ok} has_20={has_20} -7//2={fdiv} 2**3={power} swap=({a},{b}) mapSize={weights.size}")

    # enumerate(), zip(), and reversed()
    for idx, val in enumerate(nums):
        print(f"  enum[{idx}] = {val}")

    labels: list[str] = ["a", "b", "c", "d", "e"]
    for label, val in zip(labels, nums):
        print(f"  zip({label}, {val})")

    print("  reversed:")
    for r in reversed(nums):
        print(f"    {r}")
    return 0

main()
