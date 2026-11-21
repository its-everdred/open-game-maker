PYTHON ?= python3
AUDIO_PYTHON := scripts/py/audio/.venv/bin/python
DRIVE_SYNC_PYTHON := scripts/py/drive-sync/.venv/bin/python

.PHONY: test test-py test-py-models venv-audio venv-drive-sync py-compile check-workers

test: test-py

test-py:
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) -I scripts/py/drive-sync/test_drive_sync.py
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) -I scripts/assets/test_check_glb.py
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) -I scripts/assets/test_set_critic.py
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) -I scripts/assets/test_smallscaleint_ui_audit.py
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) -I scripts/py/audio/test_labels.py
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) -I scripts/py/audio/test_style_montages.py
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) -I skills/gm-trailer/scripts/test_trailer.py
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) -I scripts/py/maps/test_layout_fields.py
	$(MAKE) py-compile

test-py-models:
	@test -x "$(AUDIO_PYTHON)" || { \
		echo "missing $(AUDIO_PYTHON); run 'make venv-audio'" >&2; \
		exit 1; \
	}
	PYTHONDONTWRITEBYTECODE=1 $(AUDIO_PYTHON) -I -m pytest scripts/py/audio scripts/py/maps -p no:cacheprovider

venv-audio:
	$(PYTHON) -m venv scripts/py/audio/.venv
	$(AUDIO_PYTHON) -m pip install -r scripts/py/audio/requirements.txt

venv-drive-sync:
	$(PYTHON) -m venv scripts/py/drive-sync/.venv
	$(DRIVE_SYNC_PYTHON) -m pip install -r scripts/py/drive-sync/requirements.txt

py-compile:
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) -m compileall -q scripts/py

check-workers:
	$(PYTHON) -I -c "import json, os; workers = json.load(open('scripts/py/workers.json'))['workers']; [os.stat(worker[key]) for worker in workers.values() for key in ('dir', 'requirements')]; [worker['python'].startswith(worker['venv'] + '/') or exit(f'{name}: python is outside venv') for name, worker in workers.items()]"
