# JWT_SECRET must match users-service; it's read from ../.env when that file exists.
JWT_SECRET ?= $(shell grep -s '^JWT_SECRET=' ../.env | cut -d= -f2-)
export JWT_SECRET

.PHONY: install run test

install:
	npm install

run:
	npm run dev

test:
	npm test
