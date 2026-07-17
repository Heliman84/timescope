# TimeScope Coding Standards

To maintain consistency, clarity, and maintainability in the TimeScope project, the following coding standards are recommended based on previous collaboration and best practices:

## General Principles

* **Explicit Control:** Code should be explicit in behavior and state management, avoiding implicit side effects.
* **Maintainability:** Prioritize modular, readable, and well-documented code.
* **Ergonomics:** Design APIs and UI components for ease of use and clarity.
* **Extensibility:** Architect code to allow future enhancements without major rewrites.
* **Consistency:** Follow consistent naming, formatting, and architectural patterns.

## Code Structure and Organization

* Use a clear folder structure separating core logic, UI components, and utilities.
* Modularize large files into smaller, focused components or modules.
* Separate extension-side and webview-side code explicitly.
* Use explicit imports and avoid ambiguous relative paths.

## TypeScript and JavaScript

* Use idiomatic TypeScript patterns with strict typing.
* Define interfaces and types explicitly for data structures.
* Avoid `any` type; prefer precise types or generics.
* Use async/await for asynchronous code.
* Handle errors explicitly and gracefully.

## Naming Conventions

* Use snake_case for variables and functions.
* Use PascalCase for classes, interfaces, and types.
* Prefix private or internal members with `_`.
* Use descriptive, unambiguous names.

## Documentation and Comments

* Document all public APIs with JSDoc comments.
* Use inline comments sparingly to explain non-obvious logic.
* Maintain a changelog or notes for architectural decisions.

## Data and State Management

* Use immutable data patterns where possible.
* Maintain canonical field order in data structures.
* Codify standards for data migration and log formats.

## UI and UX

* Design ergonomic, context-aware UI elements.
* Avoid redundant or cluttered controls.
* Provide tooltips and instant context feedback.
* Ensure visual identity aligns with project metaphor and usability.

## Versioning

TimeScope is pre-1.0 (`0.y.z`) — still stabilizing. The major version stays `0` until a deliberate decision to promote to `1.0.0`; that promotion is never automatic.

* **PATCH** (`0.y.Z`) — bug fixes, internal refactors, docs/test-only changes. No user-visible behavior change beyond a fix.
* **MINOR** (`0.Y.0`) — new user-facing feature, command, or setting, or backward-compatible enhancement. While major is pinned at `0`, changes that would normally warrant a major bump (e.g. a breaking data/format change) still land as minor — treat `0.y.z` as "anything below 1.0 can move" per standard semver pre-release convention.
* **MAJOR** (`1.0.0`) — reserved for the explicit, user-driven decision to call TimeScope stable. Never proposed automatically.
* Bump timing: every feature/bugfix PR to `develop` bumps `package.json`'s `version` as part of its own commit — not batched at release. Before editing, propose the bump type and the exact `from → to` version and get explicit user confirmation; never bump silently.

## Build and Packaging

* Ensure deterministic build pipelines.
* Avoid name collisions in asset loading.
* Separate assets logically for dev and packaged modes.

## Testing and Quality

* Write unit tests for critical logic.
* Use automated linting and formatting tools.
* Perform code reviews focusing on standards adherence.

---

These standards reflect the collaborative design principles and technical rigor established for TimeScope, ensuring a professional, maintainable, and user-friendly codebase.
