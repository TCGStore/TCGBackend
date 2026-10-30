# Read from ../.env when that file exists. JWT_SECRET must match users-service.
JWT_SECRET ?= $(shell grep -s '^JWT_SECRET=' ../.env | cut -d= -f2-)
ANTHROPIC_API_KEY ?= $(shell grep -s '^ANTHROPIC_API_KEY=' ../.env | cut -d= -f2-)
ANTHROPIC_MODEL ?= $(shell grep -s '^ANTHROPIC_MODEL=' ../.env | cut -d= -f2-)
export JWT_SECRET ANTHROPIC_API_KEY ANTHROPIC_MODEL

.PHONY: install run test

install:
	npm install

run:
	npm run dev

test:
	npm test
