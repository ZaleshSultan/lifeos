# Study grading sources, 2026–2027

Initial data lives in [`syllabi/grading-seeds.json`](syllabi/grading-seeds.json). The application reads the user's versioned scheme from Supabase; it does not read PDFs at runtime or select a formula by course title. Seed import is additive and idempotent. An existing custom/legacy calculator remains authoritative until the user explicitly chooses a replacement version; historical grades and scenario values are preserved.

The five original repository PDFs were inspected on 2026-10-08 with `pdfinfo`, `pdftotext -layout` and `pdftoppm`, including visual inspection of each grading table and relevant policy pages. Operating Systems and Russian C1 have no meaningful extractable text and were read as rendered scans. The other three have imperfect OCR text, which was checked against page images. Page numbers below mean physical PDF pages, beginning at 1.

| Course and original PDF                                                                           | Grading pages                 | ATT1 components and category weights                             | ATT2 components and category weights                             |
| ------------------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| DBMS, [`Database management systems(1).pdf`](<syllabi/Database management systems(1).pdf>)        | 2                             | Assignment 1, 2, 3: 20% each; Learn Quiz: 10%; Midterm: 30%      | Assignment 4, 5, 6: 20% each; Learn Quiz: 10%; Endterm: 30%      |
| OS 2207, [`Syllabus Operating Systems CS(1).pdf`](<syllabi/Syllabus Operating Systems CS(1).pdf>) | 8 (also overall formula on 2) | Assignment 1–4: 20% each; Midterm: 20%                           | Assignment 5–8: 20% each; Endterm: 20%                           |
| DLD5, [`Digital Logic Design (CS)-1(1).pdf`](<syllabi/Digital Logic Design (CS)-1(1).pdf>)        | 5                             | Assignment 1–3: 20% each; Midterm: 40%                           | Assignment 4–6: 20% each; Endterm: 40%                           |
| CS 3145 / KSC 3216, [`Computer Networks (CS)(1).pdf`](<syllabi/Computer Networks (CS)(1).pdf>)    | 7 (also overall formula on 2) | Assignment 1–4: 20% each; Midterm: 20%                           | Assignment 5–8: 15% each; Cisco certificate: 10%; Endterm: 30%   |
| RL2202, [`Русский Язык, С1_4, 2026-2027(1).pdf`](<syllabi/Русский Язык, С1_4, 2026-2027(1).pdf>)  | 7–8                           | Written assessed work, week 4: 60% (7); Midterm, week 5: 40% (8) | Oral presentation, weeks 8–9: 60% (8); Endterm, week 10: 40% (8) |

Each ATT1 and ATT2 column sums to 100%. Final Exam contributes 100% within its own category. Each PDF states the overall formula `0.30 × ATT1 + 0.30 × ATT2 + 0.40 × Final Exam`; the seed stores these three weights explicitly. The table's assignment percentage is a category weight, independent of the raw assessment denominator.

## Raw points and admission requirements

- OS page 2 explicitly says weekly assignments use a **15-point scale**, while page 8 assigns each a **20% category weight**. These numbers are independent. The seeded denominator is 15; the actual LMS denominator can replace that scenario default.
- Networks page 2 explicitly says weekly assignments use a **20-point scale**. Its ATT2 assignment weights are 15% each. Page 3 also describes difficulty-dependent point values; actual LMS denominators take precedence over the initial 20-point scale.
- Russian pages 7–8 show a total of 100 for each assessed work/control. Page 3 describes participation as 20% inside the assessed work score, combined with the work's other 80%. This does not add a new course-level component.
- DBMS and DLD do not independently establish every raw assessment denominator in their percentage tables. No raw maximum is invented: absent `maxScore` uses a clearly normalized 100-point scenario scale until LMS/teacher data supplies the actual denominator. Entering `15/30` always normalizes to 50%, regardless of the field's initial scenario denominator.
- DBMS page 3, DLD page 3 and Russian page 2 explicitly require **at least 25% in each attestation**. These become verified per-course requirements. No equivalent numerical attestation rule was found in the inspected OS/Networks policy pages, so no 25% requirement is copied to those courses.
- Attendance **at least 70%** is stated on DBMS page 3, OS page 3, DLD page 3, Networks page 3 and Russian page 3. Accommodation/exception policies vary and must be confirmed with the university. Unknown attendance remains pending, not implicitly 100%; a confirmed violation prevents claiming achievement solely from grade arithmetic.
- Submission/defense penalties are documented in the seed notes. The calculator uses the reported grade and never applies an automatic second penalty to a score already reduced by Moodle/the teacher.

## Review items

**Russian C1 timing needs review:** the policy paragraph on page 3 refers to the first assessed work in week 3, while the assessment table on page 7 labels week 4. The verified grading weights remain 60/40. Week 4 is retained as a table-based planning hint, and the discrepancy is recorded in seed notes for teacher confirmation. No calendar deadline is generated from either week number without a course start date and explicit confirmation.

**Raw maxima:** the normalized 100-point default is not proof that a teacher grades every component out of 100. A synced or manually entered `earned/max` pair is authoritative for normalization. OS/Networks published defaults remain editable where the actual task has a different maximum.

## Checksums of original files

| File                                   | SHA-256                                                            |
| -------------------------------------- | ------------------------------------------------------------------ |
| `Database management systems(1).pdf`   | `89293598accc4fbbbeed93228f76cf88e41b6fef9d41be77fa1cabb7b77121e7` |
| `Syllabus Operating Systems CS(1).pdf` | `afd1e66d9c6448eb7800a66687adee7830894173348f8056a4cae54c67e5691a` |
| `Digital Logic Design (CS)-1(1).pdf`   | `f7b66711135d7a83b7aee7f2b5ced72769ee28dadc0abc380b80aee1a1ad50ae` |
| `Русский Язык, С1_4, 2026-2027(1).pdf` | `3b202a5738adc26ace86c94806b2e81dbc866bf8370b61f0ba740d0a3af8f812` |
| `Computer Networks (CS)(1).pdf`        | `1063302df784ddf671ac0235e5fc102b9a8a9c10891aca26a3a2210be0df9f0b` |

Reproduce inspection on Debian (Poppler):

```bash
sudo apt-get install poppler-utils
pdftotext -layout 'docs/syllabi/Database management systems(1).pdf' /tmp/dbms.txt
pdftoppm -f 8 -l 8 -scale-to 1700 -png -singlefile \
  'docs/syllabi/Syllabus Operating Systems CS(1).pdf' /tmp/os-grading-p8
sha256sum docs/syllabi/*.pdf
corepack pnpm exec vitest run packages/core/src/study.test.ts packages/core/src/study-syllabi.test.ts
```

Tests validate all five source checksums and exact component weights, 100% category sums, distinct course rules, numerator/denominator normalization, editable top-level weights, actual versus assumed scores, preserved legacy percent values, single/multiple unknown scenarios, raw-point rounding, missing data and verified constraints.

## Calculator semantics

`earned/max × categoryWeight/100 × topLevelWeight/100 × 100` is a component's contribution to the final 100-point grade. Thus DBMS Assignment 1 at 90/100 contributes 18 to ATT1 and **5.4** to the final. A Midterm at 15/30 is normalized to 50%, not interpreted as 15%. At ATT1=60 and ATT2=80, achieving 70 needs Final at least **70%**.

Old numeric scenario values remain percentage inputs and are treated as assumptions, not newly verified LMS grades. `{earned,max,kind:'actual'}` identifies a known result; `kind:'assumed'` identifies a forecast. Guaranteed contribution counts actual results only. Projection and lower/upper bounds report known/assumed contributions and explicitly retain unknown component IDs. Missing scores are never converted into saved zero grades. Zero contributes only to an explicit lower-bound scenario.

A selected unknown is solved with other unknowns at zero; this assumption must be displayed. Multiple selected variables can share a minimum normalized score while retaining separate raw maxima and explicit min/max ranges. Required raw points round **up** to the smallest attainable step (default 1). Verified component/attestation requirements are included in the solution; unverified requirements produce review warnings. Unknown attendance is not used to certify institutional eligibility.

## Historical HTML importer

`scripts/import_study_dashboard.py` remains an operator tool, dry-run by default, with course/display aliases in `syllabi/legacy-dashboard-import.json`. HTML formulas are always saved as inactive `needs_review` versions; they never overwrite a user's active scheme or `study_calculator_v1`. This includes the historical Networks/DLD aggregate formulas, which are not the verified PDF component trees.

The importer keeps existing timetable rows unchanged. A conflicting room, instructor, time or day aborts planning before any write. Changes require an explicitly supplied `--corrections` JSON file keyed by course code, with exact normalized `from` and `to` rows containing `day_of_week`, `start_time`, `end_time`, `session_type`, `instructor_name` and `room`. No correction file is enabled by default. The operator should use the PDF seed/import for verified grading schemes.

Per-scenario `maxima` are saved even when earned points remain unknown, so a selected exam denominator of 30 survives save/reload. A known `earned/max` pair retains its own authoritative denominator.
