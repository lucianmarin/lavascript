# Tab-indented LavaScript demonstrating auto-detected \t indentation

def fib(n: num) -> num:
	if n <= 1:
		return n
	var a: num = 0
	var b: num = 1
	for i in range(2, n + 1):
		next_val: num = a + b
		a = b
		b = next_val
	return b

def main() -> num:
	fibs: list[num] = [fib(k) for k in range(10)]
	for k in range(10):
		print(f"fib({k}) = {fibs[k]}")
	return 0

main()
