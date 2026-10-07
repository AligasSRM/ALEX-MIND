# Engineering Tooling Policy

Status: GREEN

## Core rule
Use the current supported version of a tool/program whenever practical. Do not knowingly keep an old and a new version of the same tool in the active workflow.

## Computer execution default
- PowerShell is the primary Windows shell for ALEX-MIND work.
- CMD is legacy/fallback only when a specific command or legacy tool requires it.
- SMB is a network file-sharing protocol, not a replacement shell; use it only when the task actually requires network file sharing.

## Version hygiene
- Before installing, invoking, or relying on a development tool, check the installed version when the version can affect compatibility.
- Prefer one current supported installation per tool.
- Remove or stop using obsolete duplicates when they are no longer required, rather than building parallel old/new workflows.
- Do not downgrade a working environment merely to accommodate an obsolete tool unless a documented compatibility requirement exists.
- If an older version must temporarily remain, document the reason and make the newer supported version the default.

## Change discipline
- Inspect the current environment before changing it.
- Do not add duplicate runtimes, shells, CLIs, packages, or configuration without a verified need.
- After updates, run the relevant version checks and project tests.
- Keep the repository and computer workflow production-oriented and reproducible.

## Scope
This policy applies to development tools, runtimes, CLIs, shells, SDKs, and other software used for the user's engineering workflows. It does not require upgrading a dependency blindly when the project's compatibility constraints require a specific supported version.
