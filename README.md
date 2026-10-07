# INDoS WG3 Training School 2026: hackathon project (Navarro Bernad)

A project by **Marta Navarro Bernad**, developed during the personal projects
session (Block 6, Friday 2 October 2026) of the
**[INDoS WG3 Training School](https://www.indos-costaction.eu/training)**,
Madrid, 30 September to 2 October 2026, run by Working Group 3 (Automated
Preprocessing Pipelines) of COST Action CA24161, INDoS.

**Project page: <https://www.indos-costaction.eu/wg3-ts2026-navarro/>**
(published at each release).

## The project

**IC Trainer** is an interactive web app that trains people to classify EEG
independent components (ICs) before removing artifacts. It follows the
practical guide by Chaumon, Bishop & Busch (2015, *J Neurosci Methods*
250:47–63, [doi:10.1016/j.jneumeth.2015.02.025](https://doi.org/10.1016/j.jneumeth.2015.02.025)).

**Open the app: <https://www.indos-costaction.eu/wg3-ts2026-navarro/trainer/>**

**Why.** Rejecting ICs always requires human judgement, and even experts
disagree on how to label them. Automated tools such as SASICA, ADJUST or
FASTER can guide the decision, but users still need to learn what each type
of component looks like. The app teaches this with immediate feedback.

**What it does.**

- *Learn:* a reading guide plus one page per category (neural, blink, eye
  movement, muscle, bad channel, rare event, mixed/other), with expected
  properties, common confusions, how automated tools detect it, and the edge
  cases discussed in the paper.
- *Practice:* classify one unknown component at a time from its topography,
  ERP image and power spectrum, then get feedback on its key features and on
  whether your error would cause over- or under-correction.
- *Full dataset:* review 40 components sorted by variance, mark those you
  would reject, and get your hit rate, false-alarm rate, d′, criterion and
  the percentage of artifact and neural variance removed, compared with a
  "reject everything SASICA flags" rule.
- *Results:* a cumulative confusion matrix and history, stored only in the
  user's browser.

**How to install.** Nothing to install: the app is a single self-contained
HTML file with no dependencies or server.

**How to run.** Open the link above, or download
[`trainer/index.html`](trainer/index.html) and open it in any modern browser.
To modify it, edit the files in [`trainer/src/`](trainer/src/) (`page.html`
for layout and styles, `core.js` for the simulation and measures, `ui.js`
for the interface) and rebuild with `python trainer/src/build.py`.

**Data.** The app uses no real recordings. All components are simulated for
teaching: topographies on a 91-channel montage plus 4 EOG channels, 100
trials from −500 to 1000 ms at 128 Hz. The automated measures
(autocorrelation, focal topography, focal trial activity, EOG correlations,
temporal kurtosis) follow SASICA's logic, with adaptive thresholds (dataset
mean + 2 SD; 4 SD for EOG correlations). EOG correlations are set per
component type rather than computed from simulated EOG signals. Next step:
load real components exported from EEGLAB or MNE-Python, with expert labels.

Developed with the assistance of Claude (Anthropic).

## Contributing the code

1. Fork this repository on GitHub and clone your fork.
2. Add the code, notebooks and documentation, and replace the section above.
3. Fill in the `TODO` placeholders in `CITATION.cff` and `.zenodo.json` (see
   [RELEASING.md](RELEASING.md)).
4. Open a pull request against `main`.

The project page (`index.html`) takes its title, authors, description and
keywords from `.zenodo.json`, so it needs no editing. Any other web page you
add (an HTML report, say) is published alongside it at the next release.

Please do not commit participant data, or imaging data that is not already
public. Point to the data instead: for example, an OpenNeuro accession number
and the subjects used.

## Releases and citing

Nothing is published on push. Each GitHub release is archived on
[Zenodo](https://zenodo.org/), which assigns it a DOI, and deploys the project
page, so the two always show the same version. `CITATION.cff` has the
citation details, and GitHub turns it into the "Cite this repository" button.

## License

The code is released under the [Apache License 2.0](LICENSE).

Not covered by that license: the INDoS, COST and European Union logos in
`assets/`, which are trademarks of their owners and are used to acknowledge
the Action and its funding.

## Acknowledgement

> This publication is based upon work from COST Action CA24161 (INDoS),
> supported by COST (European Cooperation in Science and Technology).
