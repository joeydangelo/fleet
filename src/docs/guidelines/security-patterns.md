---
name: security-patterns
description: Flag injection, arbitrary execution, broken auth, hardcoded secrets, and supply chain risks
roles: [builder, reviewer]
---
# Security Patterns

Flag code that compiles and passes tests but creates exploitable
vulnerabilities. Organized by attack surface, with concrete patterns a
reviewer can spot in a diff.

## Injection

### Command Injection

- **`child_process.exec`**: Interpolating user input into a shell string.
  Use `execFile` or `execFileSync` with argument arrays instead — they
  bypass the shell entirely.

  ```typescript
  // BAD — shell injection via string interpolation
  exec(`git checkout ${branchName}`);

  // GOOD — arguments passed as array, no shell
  execFileSync('git', ['checkout', branchName]);
  ```

- **`os.system` (Python)**: Same risk as `exec` in Node. Use
  `subprocess.run` with a list of arguments instead.

### SQL Injection

- **String-interpolated queries**: Any SQL built with template literals or
  string concatenation using external input. Use parameterized queries or
  prepared statements.

  ```typescript
  // BAD — interpolated user input
  db.query(`SELECT * FROM users WHERE id = '${userId}'`);

  // GOOD — parameterized query
  db.query('SELECT * FROM users WHERE id = $1', [userId]);
  ```

- **ORMs with raw queries**: `Sequelize.literal()`, Prisma's `$queryRawUnsafe`,
  Django's `.raw()` or `.extra()` with string formatting. Flag unless the
  input is a trusted constant.

### Cross-Site Scripting (XSS)

- **`dangerouslySetInnerHTML` (React)**: Renders raw HTML. Flag unless the
  content is sanitized with a library like DOMPurify.
- **`.innerHTML =`**: Same risk outside React. Use `textContent` for plain
  text or safe DOM methods (`createElement`, `appendChild`).
- **`document.write()`**: Can inject arbitrary HTML. Use DOM manipulation
  methods instead.

### GitHub Actions Injection

Untrusted input from `github.event.*` fields (issue titles, PR bodies,
commit messages, comment bodies) interpolated directly in `run:` blocks
allows arbitrary command execution.

```yaml
# BAD — attacker-controlled input in run command
run: echo "${{ github.event.issue.title }}"

# GOOD — pass through environment variable
env:
  TITLE: ${{ github.event.issue.title }}
run: echo "$TITLE"
```

Risky fields to watch for in workflow files:
- `github.event.issue.title` / `.body`
- `github.event.pull_request.title` / `.body` / `.head.ref` / `.head.label` / `.head.repo.default_branch`
- `github.event.comment.body`
- `github.event.review.body`
- `github.event.review_comment.body`
- `github.event.commits.*.message` / `.author.email` / `.author.name`
- `github.event.head_commit.message` / `.author.email` / `.author.name`
- `github.event.pages.*.page_name`
- `github.head_ref`

## Arbitrary Code Execution

- **`eval()`**: Executes arbitrary strings as code. Use `JSON.parse()` for
  data parsing or restructure to avoid runtime code evaluation.
- **`new Function()`**: Same risk as `eval` with dynamic strings. Flag
  unless the input is a static, trusted template.
- **`pickle` (Python)**: Deserializing untrusted pickle data executes
  arbitrary code. Use JSON or another safe serialization format.
- **`yaml.load()` (Python)**: The default loader executes arbitrary Python.
  Use `yaml.safe_load()`.

## Broken Access Control

Flag missing or incorrect authorization checks — the most common
vulnerability category in the OWASP Top 10.

- **Missing ownership checks on object access**: An endpoint that fetches a
  resource by ID without verifying the requesting user owns it (insecure
  direct object reference). Every data-access path needs an ownership or
  role check.

  ```typescript
  // BAD — any authenticated user can access any invoice
  app.get('/invoices/:id', auth, (req, res) => {
    return db.invoices.findById(req.params.id);
  });

  // GOOD — scoped to the requesting user
  app.get('/invoices/:id', auth, (req, res) => {
    return db.invoices.findOne({ id: req.params.id, userId: req.user.id });
  });
  ```

- **Permissive CORS**: `Access-Control-Allow-Origin: *` on endpoints that
  serve private data. Restrict to known origins.
- **Missing auth middleware on routes**: New endpoints added without the
  auth/authz middleware that protects the rest of the router. Flag
  unprotected routes in protected route groups.
- **Client-side-only authorization**: Hiding UI elements is not access
  control. The server must enforce permissions regardless of what the
  client renders.

## Authentication Failures

- **Plaintext password storage**: Any code that stores or compares passwords
  without hashing. Use bcrypt, scrypt, or argon2.
- **Weak session tokens**: Tokens generated with `Math.random()`, `uuid.v1()`,
  or other predictable sources. Use `crypto.randomBytes()` or
  `crypto.randomUUID()`.
- **Missing rate limiting on auth endpoints**: Login, registration, and
  password reset endpoints without rate limiting enable brute-force attacks.
  Flag auth routes that don't apply a rate limiter.
- **Credentials in URLs**: Tokens or passwords passed as query parameters
  (logged by servers, proxies, and browsers). Use headers or request bodies.

## Cryptographic Failures

- **Weak hash algorithms for security purposes**: MD5 and SHA1 for password
  hashing, token generation, or integrity verification. These are fast
  and collision-prone. Use bcrypt/argon2 for passwords, SHA-256+ for
  integrity.
- **Hardcoded secrets**: API keys, encryption keys, or database passwords
  in source files — including test fixtures and example configs. These
  belong in environment variables or secret managers.
- **`Math.random()` for security-sensitive values**: Not cryptographically
  secure. Use `crypto.randomBytes()`, `crypto.getRandomValues()`, or
  `secrets` (Python).
- **Disabled TLS verification**: `rejectUnauthorized: false`,
  `verify=False` (Python requests), `NODE_TLS_REJECT_UNAUTHORIZED=0`.
  Flag unless it's a local dev-only code path with a clear comment.

## Supply Chain & Dependency Risks

- **Unpinned dependencies**: Using `*`, `latest`, or broad version ranges
  for dependencies. Pin to exact versions or use a lockfile.
- **`curl | bash` / `wget | sh`**: Piping remote scripts directly into a
  shell. Download first, verify the checksum, then execute.
- **Post-install scripts from untrusted packages**: `npm install` runs
  arbitrary scripts by default. Flag new dependencies that haven't been
  vetted, especially if they include `preinstall`/`postinstall` hooks.
- **Lockfile changes without dependency changes**: A modified lockfile
  with no corresponding change in the manifest (`package.json`,
  `pyproject.toml`) may indicate a lockfile injection attack. Flag for
  manual review.

## Security Misconfiguration

- **Debug mode in production**: `DEBUG=True` (Django), `app.debug = True`
  (Flask), `NODE_ENV !== 'production'` checks missing. Debug mode exposes
  stack traces, internal paths, and sometimes interactive consoles.
- **Default credentials**: Admin accounts with `admin/admin`, `root/root`,
  or any password committed to source. Flag even in seed scripts.
- **Overly permissive headers**: `X-Frame-Options` missing (clickjacking),
  `Strict-Transport-Security` missing, `Content-Security-Policy` set to
  `unsafe-inline` or `unsafe-eval`.
- **Exposed internal endpoints**: Health checks, metrics, or admin panels
  bound to `0.0.0.0` without authentication.

## Error Handling & Information Exposure

- **Stack traces in API responses**: Unfiltered error objects sent to
  clients expose internal paths, dependency versions, and code structure.
  Return generic error messages; log details server-side.

  ```typescript
  // BAD — leaks internals to the client
  app.use((err, req, res, next) => {
    res.status(500).json({ error: err.stack });
  });

  // GOOD — generic message, detailed logging
  app.use((err, req, res, next) => {
    logger.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });
  ```

- **Secrets in error messages or logs**: Logging request bodies, headers
  (especially `Authorization`), or environment variables that contain
  tokens. Redact sensitive fields before logging.
- **Empty catch blocks**: Swallowing errors silently hides failures and
  can mask security-relevant events. At minimum, log the error.

## Logging & Monitoring Gaps

- **Logging PII or secrets**: Passwords, tokens, SSNs, credit card numbers
  in log output. Scrub or mask sensitive fields before logging.
- **No logging on auth events**: Failed logins, password resets, privilege
  changes, and access denials should produce audit log entries. Flag auth
  flows with no logging.

## General Principles

- **Validate at trust boundaries**: User input, external API responses,
  deserialized data, and URL parameters. Internal function calls between
  trusted modules don't need redundant validation.
- **Never interpolate untrusted strings into commands, queries, or HTML**.
  Use parameterized queries (SQL), argument arrays (shell), and safe DOM
  methods (browser).
- **Prefer allowlists over denylists**: Validate that input matches a known
  set of acceptable values rather than trying to filter out bad ones.
- **Apply defense in depth**: Don't rely on a single layer (e.g., client-side
  validation alone). Server-side enforcement is mandatory; client-side
  checks are a UX convenience.
