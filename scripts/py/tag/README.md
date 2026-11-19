# Local visual sheet tagger

`tag_sheets.py` reads model, sprite, and VFX preview sheets and writes only C3 descriptive fields. It uses
`openai/clip-vit-large-patch14` from the existing Hugging Face cache with `local_files_only=True`; a missing cache is a
hard error and never triggers a download.

The worker requires effective `vision-input` rights and `processing` equal to `any` or `local-only`. It lift-ranks only
the enums in the card schema, derives open-vocabulary objects from filenames, preserves locked human fields, stages card
writes, validates them, and promotes them only after the batch is valid.

Run pure tests with:

```sh
../audio/.venv/bin/python -I -m pytest test_tag_sheets.py -p no:cacheprovider -q
```
