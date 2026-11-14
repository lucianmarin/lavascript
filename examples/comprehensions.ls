# List, Set, and Dict (Map / Record) comprehensions in LavaScript

def main() -> num:
    # 1. List comprehension -> T[] (`list[num]`)
    squares: list[num] = [x * x for x in range(1, 7) if x % 2 == 0]
    doubled: list[num] = [x * 2 for x in squares if x > 4]
    print(f"List (squares): [{squares.join(', ')}] | doubled: [{doubled.join(', ')}]")

    # 2. Set comprehension -> Set<T> (`set[num]`)
    uniq_mods: set[num] = {x % 4 for x in range(10)}
    even_set: set[num] = {x for x in range(8) if x % 2 == 0}
    print(f"Set (uniq_mods size={uniq_mods.size}): [{Array.from(uniq_mods).join(', ')}] | has(4)={even_set.has(4)}")

    # 3. Dict comprehensions -> Map<K, V> (`dict[K, V]`) and Record<K, V> (`rec[K, V]`)
    square_map: dict[num, num] = {x: x * 10 for x in squares if x > 0}
    label_rec: rec[str, num] = {f"k{x}": x * 2 for x in squares if x > 0}
    print(f"Map (size={square_map.size}, get(16)={square_map.get(16)}) | Record k36={label_rec['k36']}")
    return 0

main()
