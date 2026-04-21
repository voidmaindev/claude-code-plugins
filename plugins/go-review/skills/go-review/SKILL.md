---
name: go-review
description: Review Go codebase as a senior software architect
user-invocable: true
argument-hint: "[path or file]"
---

Review this Go codebase as a senior software architect and Go expert. Analyze:

**Architecture & Design**
- Overall project structure and package organization
- Separation of concerns and layer boundaries
- Dependency injection and inversion of control
- Interface design and abstraction quality

**Go Idioms & Best Practices**
- Proper use of Go conventions (naming, error handling, etc.)
- Effective use of interfaces, embedding, and composition
- Concurrency patterns (goroutines, channels, sync primitives)
- Context propagation and cancellation

**Code Quality**
- DRY violations and code duplication
- SOLID principles adherence
- Testability and test coverage approach
- Error handling consistency

**Production Readiness**
- Configuration management
- Logging and observability
- Security considerations
- Performance and resource management

Provide:
1. A summary of strengths
2. A prioritized list of issues (critical → minor)
3. Specific, actionable recommendations with code examples where helpful

$ARGUMENTS
