# Communication Policy

Status: GREEN

## Purpose
Keep computer-side inspection and delivery requests consistent without repeatedly asking which connected Outlook account to use.

## Rules
- The user has two connected Outlook email accounts.
- Default delivery account: the user's designated computer-work email account (currently the account most recently explicitly selected for sending).
- Do not ask the user to choose between the two connected Outlook accounts unless delivery through the default account fails or the user explicitly requests another account.
- When a task requires the user to inspect something on the computer, provide the needed item through email when practical (for example: a link, exact command, file, screenshot request, or verification step).
- For PowerShell/CMD/SMB-related inspection, email the exact copy/paste-ready instruction or artifact rather than repeatedly asking where to send it.
- Never store personal email addresses, Outlook link IDs, access tokens, passwords, or other secrets in GitHub repository files.
- Repository policy stores only the communication rule; actual account routing remains in the connected email integration.

## Operational default
If the user says "send it to me" without naming an account, use the currently designated default connected Outlook account. Only ask when that route is unavailable or ambiguous after a real delivery failure.
