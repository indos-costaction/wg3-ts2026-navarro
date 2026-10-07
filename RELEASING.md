# Releasing to Zenodo

Every release published on GitHub is archived on Zenodo automatically, and
Zenodo assigns it a DOI. Zenodo takes the record's metadata from
`.zenodo.json`, and the version from the release tag. GitHub's "Cite this
repository" button reads `CITATION.cff`. Keep the two files in agreement.

## 1. Fill in the metadata (author)

In **both** `CITATION.cff` and `.zenodo.json`:

- **Title:** the project title.
- **Abstract / description:** one paragraph on what the project does and what
  it is for. Keep the closing sentence about the training school. In
  `.zenodo.json` the description is HTML, so wrap paragraphs in `<p>...</p>`.
- **Affiliation:** institution, city, country.
- **ORCID** (recommended):
  - in `CITATION.cff`, add `orcid: "https://orcid.org/XXXX-XXXX-XXXX-XXXX"`
    under the author;
  - in `.zenodo.json`, add `"orcid": "XXXX-XXXX-XXXX-XXXX"` (no URL) to the
    creator.
- **Keywords:** add a few on the topic, and keep the existing ones.
- **More authors:** add one entry per person to `authors` (in `CITATION.cff`)
  and to `creators` (in `.zenodo.json`), in the same order.

The **Release metadata** check (GitHub Actions) fails while any `TODO` is
left or either file is invalid. It must pass on `main` before the release.

## 2. Check that Zenodo is switched on (maintainers)

Do this **before** publishing the release, because Zenodo only archives
releases published while the switch is on.

1. Sign in to <https://zenodo.org/account/settings/github/> with the account
   that archives the other `indos-costaction/wg3-ts2026-*` repositories.
2. Click **Sync now**.
3. Turn on `indos-costaction/wg3-ts2026-navarro`.

To check it is on, look for a `zenodo.org` webhook under the repository's
**Settings > Webhooks**.

## 3. Publish the release (maintainers)

1. On GitHub, go to **Releases > Draft a new release**.
2. Create a new tag, `1.0.0`, on `main`. The other training school
   repositories use tags without a `v`.
3. Write the title and a few lines of release notes.
4. Click **Publish release**.

Zenodo picks up the release within a few minutes. The new record is listed at
<https://zenodo.org/account/settings/github/repository/indos-costaction/wg3-ts2026-navarro>.

## 4. Add the DOI badge

Copy the **concept DOI** badge from that page into `README.md`, under the
title. The concept DOI always resolves to the latest version, and each release
also gets its own DOI. Later releases (`1.0.1`, `1.1.0`, ...) are new
versions of the same Zenodo record.
