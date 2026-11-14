NODE ?= node

PREFIX ?= $(shell brew --prefix 2>/dev/null || echo /usr/local)
BINDIR ?= $(DESTDIR)$(PREFIX)/bin

TARGET = lavascript
SRC = lavascript.ts

.PHONY: all test bench install uninstall clean

all: $(TARGET)

$(TARGET): $(SRC)
	$(NODE) --no-warnings -e 'const fs = require("node:fs"), m = require("node:module"); fs.writeFileSync("$(TARGET)", m.stripTypeScriptTypes(fs.readFileSync("$(SRC)", "utf8")), { mode: 0o755 });'

test: $(TARGET)
	./$(TARGET) --test

bench: $(TARGET)
	./$(TARGET) --bench

install: $(TARGET)
	install -d "$(BINDIR)"
	install -m 755 $(TARGET) "$(BINDIR)/$(TARGET)"

uninstall:
	rm -f "$(BINDIR)/$(TARGET)"

clean:
	rm -f $(TARGET)
