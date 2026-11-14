# Minimal introduction to LavaScript types, functions, comprehensions, and loops

MAX_GREETINGS = 3

def greet(name: str, count: num) -> num:
    if name == "" or count <= 0:
        return 0
    steps: list[num] = [i + 1 for i in range(MAX_GREETINGS)]
    for i in range(count):
        print(f"[{steps[i]}] Hello from LavaScript, {name}!")
    return count

def main() -> num:
    sent: num = greet("World", MAX_GREETINGS)
    if sent > 0 and not (sent > 10):
        print(f"Successfully sent {sent} greetings.")
    return 0

main()
