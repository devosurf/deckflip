# Triage labels

Canonical roles map directly to GitHub labels.

## Categories

| Role | Label | Meaning |
| --- | --- | --- |
| bug | bug | Existing behavior is broken |
| enhancement | enhancement | New feature or improvement |

## States

| Role | Label | Meaning |
| --- | --- | --- |
| needs-triage | needs-triage | Maintainer needs to evaluate |
| needs-info | needs-info | Waiting on reporter information |
| ready-for-agent | ready-for-agent | Fully specified for an AFK agent |
| ready-for-human | ready-for-human | Requires human implementation or judgment |
| wontfix | wontfix | Will not be actioned |

Each triaged issue carries exactly one category and one state.
Replace the previous state when transitioning; preserve unrelated labels.
If multiple state labels conflict, ask the maintainer before changing them.

Unlabeled issues normally enter needs-triage, then move to needs-info,
ready-for-agent, ready-for-human, or wontfix. Reporter replies return
needs-info issues to needs-triage. Flag unusual transitions for maintainer
direction; explicit maintainer overrides take precedence.

Existing wayfinder labels describe separate workflow roles, not triage states.
