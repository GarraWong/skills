---
name: feature-risk-assessment
description: Score one Freya feature on the eight-question Feature Risk Assessment and write Feature Risk Assessment Template 4. Use when the user asks to score a feature, run an FMEA, or produce a Feature_Risk_Assessment workbook from a spec or acceptance criteria. Does not score a release-level change impact assessment.
---

# Feature risk assessment

Produce one feature-level workbook from Feature Risk Assessment Template 4. Questions a–h are scored 1–10. Severity is the average of a–d, Likelihood of e–f, and Detectability of g–h. `RPN = S × L × D`. Low Risk is 100 or below, Medium Risk is 200 or below, and High Risk is above 200.

This skill does not score a release-level Risk Based Change Impact Assessment. Leave those workbooks untouched.

## Safety and context

- Show the eight scores, a reason for each, S, L, D, RPN, and the risk category before writing. Write only after the user confirms that set, or names a replacement set.
- Copy the bundled template. Do not start from an older filled workbook. Those files have a Comment column; Template 4 does not. Do not add a column, and do not write comments into the workbook. Reasoning stays in the conversation.
- Do not change headers, answer text, merged cells, number formats, or the formulas in D10:D14.
- Do not overwrite an existing assessment unless the user asks to replace that file. These six Archive 1.0.0 features are already human-reviewed; treat a request for one of them as a dry run and write outside the release folder unless the user explicitly says to replace the real file: 276920 Upload, 276921 Record View, 276922 Access Control, 276923 Audit Trail, 276926 Folder View, 276931 Archive Manager.
- A wrong score is recoverable: write a new copy from the template. Do not delete an existing assessment.

## Defaults

| Setting | Value |
| --- | --- |
| Module | Archive. Filename token `Archive`. Override when the user names another module. |
| Template | `templates/Feature Risk Assessment Template 4.xlsx`, next to this skill. Sheet `Feature Risk Assessment`. |
| Scores | D2=a, D3=b, D4=c, D5=d, D6=e, D7=f, D8=g, D9=h. Integers 1–10. |
| Output name | `Feature_Risk_Assessment-Freya-{Module}_V{version}-Feature {id}_ {title}.xlsx` |
| Output directory | `<release root>/<version>/` when this is a real scoring. Release root is `FREYA_ARCHIVE_RELEASE_ROOT`, otherwise the single path in `scripts/release-root.path`. If neither is set, or the path is missing, ask once and save the path the user gives into `scripts/release-root.path`. That file is gitignored; an install update overwrites the skill copy, so the environment variable is the durable place for the path. For a dry run, write beside the scratch location the user names. |
| Archive main flow | Upload, then archive, then view, then audit. Upload is the main flow. Records are immutable after creation. Classification is chosen at upload time. |
| Docs main flow | Not established. Ask once before scoring Severity. Do not guess. |
| Language of the reasoning | The language the user is using. |

## Steps

1. Take the module, release version, feature ID, feature title, and the requirement text. If the user gives an Azure DevOps work item ID or URL and an Azure DevOps client is available, fetch the Description and Acceptance Criteria from project `Freyr-Unified-RIMS` unless they named another project. If that fetch fails, say what failed and ask them to paste the text. When both an OpenSpec `spec.md` and work-item text exist, prefer `spec.md`. Skip any spec whose path is marked 过时, Out of Date, or 停用.
2. Read [the GxP / Part 11 baseline](references/gxp-part11-baseline.md) in full before assigning any score. Score a–h against that baseline and the module's main flow. Run `report` and include its S, L, D, RPN, and category in the reply, with a short reason for each score. Stop there.
3. If the user changes a score or a reason, change only those items, check that the score still sits in the bucket the reason describes, and run `report` again. Wait for a fresh confirmation. Do not write on the same turn as an adjustment.
4. After the user confirms the scores and the reasons, run `write`. Pass `--force` only when they asked to replace that file. Then report the path, the eight scores, S, L, D, RPN, and the category.

## Question scale

| Item | Question | 1–3 | 4–7 | 8–10 |
| --- | --- | --- | --- | --- |
| a | Product quality impact | Minimal or none | Moderate, needs rework | Severe, affects outputs |
| b | Incorrect results or disruption | Unlikely | Possible, manageable | Likely, major consequences |
| c | Patient safety | No safety impact | Potential, harm unlikely | Significant safety risk |
| d | Regulatory non-compliance | No regulatory impact | Potential, correctable | Definite, needs corrective action |
| e | Likelihood under normal use | Rare | Possible, not frequent | Likely |
| f | Past failure of a similar feature | None | Some | Frequent |
| g | How hard failure is to detect | Easy, routine checks | Detectable with effort | Hard without significant testing |
| h | Existing controls | Comprehensive | Partial | None effective |

A higher score on g or h means the failure is harder to see or less well controlled.

## Scripts

Run [`scripts/feature_assessment.py`](scripts/feature_assessment.py) with `python3`. It needs Python 3.9+ and the standard library only.

```
python3 scripts/feature_assessment.py report --scores <8 integers>
python3 scripts/feature_assessment.py write --template <template.xlsx> --output <file.xlsx> --scores <8 integers>
```

`--scores` is a through h, comma-separated, each from 1 to 10. `report` prints S, L, D, RPN, and the risk category. `write` copies the template, fills D2:D9, leaves D10:D14 as formulas, and sets the workbook to recalculate on open. It refuses to overwrite unless `--force` is set.

## Completion

Report the workbook path, the eight scores, S, L, D, RPN, and the risk category. Keep the score reasons in the same reply.
