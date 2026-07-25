import { describe, expect, it } from 'vitest';
import { parsers } from '@/lib/parsing';
import { csharpParser } from '@/lib/parsing/languages/csharp';
import { goParser } from '@/lib/parsing/languages/go';
import { javaParser } from '@/lib/parsing/languages/java';
import { phpParser } from '@/lib/parsing/languages/php';
import { pythonParser } from '@/lib/parsing/languages/python';
import { rustParser } from '@/lib/parsing/languages/rust';

const parse = (parser: { parse: typeof pythonParser.parse }, path: string, content: string) =>
  parser.parse({ path, content, bytes: content.length });

describe('python parser', () => {
  const result = parse(
    pythonParser,
    'app/service.py',
    `
import os
import json as j
from typing import List, Optional
from .models import User, Account
from ..shared.db import session


class UserService(BaseService, Mixin):
    """Handles users."""

    def __init__(self, repo):
        self.repo = repo

    async def find(self, user_id: str) -> Optional[User]:
        if not user_id:
            raise ValueError("missing")
        for candidate in self.repo.all():
            if candidate.id == user_id:
                return candidate
        return None


@decorator
def helper(a, b=2):
    return a + b


API_KEY = os.environ.get("API_KEY")
DB = os.getenv("DATABASE_URL")
`,
  );

  it('extracts plain and from-imports', () => {
    const specifiers = result.imports.map((i) => i.specifier);
    expect(specifiers).toContain('os');
    expect(specifiers).toContain('json');
    expect(specifiers).toContain('typing');
    expect(specifiers).toContain('.models');
    expect(specifiers).toContain('..shared.db');
    expect(result.imports.find((i) => i.specifier === '.models')?.symbols).toEqual([
      'User',
      'Account',
    ]);
  });

  it('extracts classes, methods and decorators', () => {
    const cls = result.symbols.find((s) => s.name === 'UserService');
    expect(cls?.kind).toBe('class');
    expect(cls?.extends).toEqual(['BaseService', 'Mixin']);
    expect(cls?.doc).toContain('Handles users');

    const find = result.symbols.find((s) => s.name === 'find');
    expect(find?.kind).toBe('method');
    expect(find?.container).toBe('UserService');
    expect(find?.isAsync).toBe(true);
    expect(find?.params).toEqual(['user_id: str']);
    expect(find?.complexity).toBeGreaterThan(2);

    expect(result.symbols.find((s) => s.name === 'helper')?.decorators).toContain('decorator');
    expect(result.symbols.find((s) => s.name === '__init__')?.visibility).toBe('private');
  });

  it('extracts env vars', () => {
    const names = result.envRefs.map((r) => r.name);
    expect(names).toContain('API_KEY');
    expect(names).toContain('DATABASE_URL');
  });
});

describe('go parser', () => {
  const result = parse(
    goParser,
    'internal/server/server.go',
    `
package server

import (
	"context"
	"fmt"

	"github.com/acme/app/internal/store"
)

import "os"

type Server struct {
	store store.Store
	port  int
}

type Handler interface {
	Serve(ctx context.Context) error
}

func New(s store.Store) *Server {
	return &Server{store: s}
}

func (s *Server) Serve(ctx context.Context) error {
	if s.port == 0 {
		return fmt.Errorf("no port")
	}
	for i := 0; i < 3; i++ {
		s.store.Ping(ctx)
	}
	return nil
}

var addr = os.Getenv("LISTEN_ADDR")
`,
  );

  it('extracts grouped and single imports', () => {
    const specifiers = result.imports.map((i) => i.specifier);
    expect(specifiers).toContain('context');
    expect(specifiers).toContain('fmt');
    expect(specifiers).toContain('github.com/acme/app/internal/store');
    expect(specifiers).toContain('os');
  });

  it('extracts structs, interfaces, funcs and methods', () => {
    expect(result.symbols.find((s) => s.name === 'Server')?.kind).toBe('struct');
    expect(result.symbols.find((s) => s.name === 'Handler')?.kind).toBe('interface');
    const ctor = result.symbols.find((s) => s.name === 'New');
    expect(ctor?.kind).toBe('function');
    expect(ctor?.isExported).toBe(true);
    const serve = result.symbols.find((s) => s.name === 'Serve' && s.kind === 'method');
    expect(serve?.container).toBe('Server');
    expect(serve?.complexity).toBeGreaterThan(2);
  });

  it('captures package name and env vars', () => {
    expect(result.exports[0]).toMatchObject({ name: 'server', kind: 'namespace' });
    expect(result.envRefs.map((r) => r.name)).toContain('LISTEN_ADDR');
  });
});

describe('rust parser', () => {
  const result = parse(
    rustParser,
    'src/lib.rs',
    `
use std::collections::{HashMap, HashSet};
use crate::models::User;
mod handlers;

pub struct Repo {
    items: HashMap<String, User>,
}

pub trait Store {
    fn get(&self, id: &str) -> Option<User>;
}

pub enum Error { NotFound, Invalid }

impl Store for Repo {
    fn get(&self, id: &str) -> Option<User> {
        match self.items.get(id) {
            Some(u) => Some(u.clone()),
            None => None,
        }
    }
}

pub async fn run(port: u16) -> Result<(), Error> {
    let key = std::env::var("SECRET_KEY");
    Ok(())
}
`,
  );

  it('expands grouped use declarations', () => {
    const specifiers = result.imports.map((i) => i.specifier);
    expect(specifiers).toContain('std::collections::HashMap');
    expect(specifiers).toContain('std::collections::HashSet');
    expect(specifiers).toContain('crate::models::User');
    expect(specifiers).toContain('self::handlers');
  });

  it('extracts structs, traits, enums and impl methods', () => {
    expect(result.symbols.find((s) => s.name === 'Repo')?.kind).toBe('struct');
    expect(result.symbols.find((s) => s.name === 'Store')?.kind).toBe('trait');
    expect(result.symbols.find((s) => s.name === 'Error')?.kind).toBe('enum');
    // `get` is declared twice: once on the trait, once in the impl block.
    const declared = result.symbols.find((s) => s.name === 'get' && s.container === 'Store');
    expect(declared?.kind).toBe('method');
    const implemented = result.symbols.find((s) => s.name === 'get' && s.container === 'Repo');
    expect(implemented?.kind).toBe('method');
    expect(implemented?.implements).toEqual(['Store']);
    const run = result.symbols.find((s) => s.name === 'run');
    expect(run?.isAsync).toBe(true);
    expect(run?.isExported).toBe(true);
  });

  it('extracts env vars', () => {
    expect(result.envRefs.map((r) => r.name)).toContain('SECRET_KEY');
  });
});

describe('java parser', () => {
  const result = parse(
    javaParser,
    'src/main/java/com/acme/UserController.java',
    `
package com.acme.web;

import java.util.List;
import com.acme.service.UserService;
import static org.junit.Assert.*;

@RestController
public class UserController extends BaseController implements Auditable {
    private final UserService service;
    public static final int MAX = 10;

    public UserController(UserService service) {
        this.service = service;
    }

    @GetMapping("/users")
    public List<User> list(int page) {
        if (page < 0) { throw new IllegalArgumentException(); }
        return service.findAll(page);
    }

    private void audit(String action) {
        System.getenv("AUDIT_SINK");
    }
}

interface Auditable { void audit(String action); }
`,
  );

  it('extracts imports and package', () => {
    const specifiers = result.imports.map((i) => i.specifier);
    expect(specifiers).toContain('java.util.List');
    expect(specifiers).toContain('com.acme.service.UserService');
    expect(result.exports[0]).toMatchObject({ name: 'com.acme.web', kind: 'namespace' });
  });

  it('extracts classes, inheritance and members', () => {
    const cls = result.symbols.find((s) => s.name === 'UserController');
    expect(cls?.kind).toBe('class');
    expect(cls?.extends).toEqual(['BaseController']);
    expect(cls?.implements).toEqual(['Auditable']);
    expect(cls?.visibility).toBe('public');

    const list = result.symbols.find((s) => s.name === 'list');
    expect(list?.kind).toBe('method');
    expect(list?.container).toBe('UserController');
    expect(list?.returnType).toContain('List');

    expect(result.symbols.find((s) => s.name === 'audit' && s.container === 'UserController')?.visibility).toBe(
      'private',
    );
    expect(result.symbols.find((s) => s.name === 'Auditable')?.kind).toBe('interface');
    expect(result.symbols.some((s) => s.name === 'service' && s.kind === 'variable')).toBe(true);
  });

  it('extracts env vars', () => {
    expect(result.envRefs.map((r) => r.name)).toContain('AUDIT_SINK');
  });
});

describe('csharp parser', () => {
  const result = parse(
    csharpParser,
    'src/Api/UserController.cs',
    `
using System;
using System.Collections.Generic;
using Acme.Services;

namespace Acme.Api;

public class UserController : ControllerBase, IUserController
{
    private readonly IUserService _service;
    public string Name { get; set; }

    public UserController(IUserService service) => _service = service;

    public async Task<IActionResult> GetAsync(int id)
    {
        if (id <= 0) return BadRequest();
        var key = Environment.GetEnvironmentVariable("API_KEY");
        return Ok(await _service.FindAsync(id));
    }
}

public interface IUserController { }
public record UserDto(string Id, string Email);
`,
  );

  it('extracts using directives and namespace', () => {
    const specifiers = result.imports.map((i) => i.specifier);
    expect(specifiers).toContain('System');
    expect(specifiers).toContain('System.Collections.Generic');
    expect(specifiers).toContain('Acme.Services');
    expect(result.exports[0]).toMatchObject({ name: 'Acme.Api', kind: 'namespace' });
  });

  it('splits base classes from interfaces', () => {
    const cls = result.symbols.find((s) => s.name === 'UserController');
    expect(cls?.extends).toEqual(['ControllerBase']);
    expect(cls?.implements).toEqual(['IUserController']);
    expect(result.symbols.find((s) => s.name === 'IUserController')?.kind).toBe('interface');
    expect(result.symbols.find((s) => s.name === 'UserDto')?.kind).toBe('struct');
    const method = result.symbols.find((s) => s.name === 'GetAsync');
    expect(method?.kind).toBe('method');
    expect(method?.isAsync).toBe(true);
  });

  it('extracts env vars', () => {
    expect(result.envRefs.map((r) => r.name)).toContain('API_KEY');
  });
});

describe('php parser', () => {
  const result = parse(
    phpParser,
    'app/Http/UserController.php',
    `<?php

namespace App\\Http;

use App\\Models\\User;
use App\\Services\\{UserService, MailService};
require_once __DIR__ . '/helpers.php';

class UserController extends Controller implements Arrayable
{
    private UserService $service;

    public function __construct(UserService $service)
    {
        $this->service = $service;
    }

    public function index(Request $request)
    {
        if (!$request->user()) {
            abort(403);
        }
        return $this->service->all();
    }
}

trait Loggable { public function log(string $m) {} }

function bootstrap(): void {
    $key = getenv('APP_KEY');
}
`,
  );

  it('extracts use declarations including grouped form', () => {
    const specifiers = result.imports.map((i) => i.specifier);
    expect(specifiers).toContain('App\\Models\\User');
    expect(specifiers).toContain('App\\Services\\UserService');
    expect(specifiers).toContain('App\\Services\\MailService');
    expect(result.exports[0]).toMatchObject({ name: 'App\\Http', kind: 'namespace' });
  });

  it('extracts classes, traits, methods and top-level functions', () => {
    const cls = result.symbols.find((s) => s.name === 'UserController');
    expect(cls?.extends).toEqual(['Controller']);
    expect(cls?.implements).toEqual(['Arrayable']);
    expect(result.symbols.find((s) => s.name === 'index')?.container).toBe('UserController');
    expect(result.symbols.find((s) => s.name === 'Loggable')?.kind).toBe('trait');
    expect(result.symbols.find((s) => s.name === 'bootstrap')?.kind).toBe('function');
  });

  it('extracts env vars', () => {
    expect(result.envRefs.map((r) => r.name)).toContain('APP_KEY');
  });
});

describe('parser registry', () => {
  it('routes files to the right parser', () => {
    expect(parsers.forPath('a/b.ts')?.id).toBe('typescript');
    expect(parsers.forPath('a/b.tsx')?.id).toBe('typescript');
    expect(parsers.forPath('a/b.mjs')?.id).toBe('javascript');
    expect(parsers.forPath('a/b.py')?.id).toBe('python');
    expect(parsers.forPath('a/b.go')?.id).toBe('go');
    expect(parsers.forPath('a/b.rs')?.id).toBe('rust');
    expect(parsers.forPath('a/b.cs')?.id).toBe('csharp');
    expect(parsers.forPath('a/b.php')?.id).toBe('php');
    expect(parsers.forPath('a/b.java')?.id).toBe('java');
    expect(parsers.forPath('a/b.txt')).toBeUndefined();
  });

  it('returns an empty record for unsupported languages', () => {
    const result = parsers.parse({ path: 'readme.md', content: '# hi\n\nthere', bytes: 11 });
    expect(result.symbols).toEqual([]);
    expect(result.loc.total).toBe(3);
  });

  it('exposes all eight analysed languages', () => {
    expect(parsers.list()).toHaveLength(8);
  });
});
