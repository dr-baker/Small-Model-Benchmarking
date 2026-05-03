.PHONY: viz

VISUALIZER_HOST ?= 127.0.0.1
VISUALIZER_PORT ?= 5173
VISUALIZER_URL ?= http://$(VISUALIZER_HOST):$(VISUALIZER_PORT)
BENCHMARK_RESULTS_ROOT ?= $(CURDIR)/benchmark-results

viz: ## Freshly start the visualizer and open the version-picker site.
	@echo "Starting fresh benchmark visualizer at $(VISUALIZER_URL)"
	@echo "Using benchmark results from $(BENCHMARK_RESULTS_ROOT)"
	@existing_pids=$$(lsof -tiTCP:$(VISUALIZER_PORT) -sTCP:LISTEN 2>/dev/null || true); \
	if [ -n "$$existing_pids" ]; then \
		echo "Stopping existing listener(s) on port $(VISUALIZER_PORT): $$existing_pids"; \
		kill $$existing_pids 2>/dev/null || true; \
		sleep 1; \
	fi; \
	cd apps/visualizer && \
		BENCHMARK_RESULTS_ROOT="$(BENCHMARK_RESULTS_ROOT)" npm run generate && \
		BENCHMARK_RESULTS_ROOT="$(BENCHMARK_RESULTS_ROOT)" npm run dev -- --host $(VISUALIZER_HOST) --port $(VISUALIZER_PORT) --strictPort & \
	server_pid=$$!; \
	for attempt in $$(seq 1 60); do \
		if lsof -tiTCP:$(VISUALIZER_PORT) -sTCP:LISTEN >/dev/null 2>&1; then \
			open "$(VISUALIZER_URL)"; \
			wait $$server_pid; \
			exit $$?; \
		fi; \
		if ! kill -0 $$server_pid 2>/dev/null; then \
			echo "Visualizer failed before opening $(VISUALIZER_URL)"; \
			wait $$server_pid; \
			exit $$?; \
		fi; \
		sleep 0.5; \
	done; \
	echo "Timed out waiting for visualizer at $(VISUALIZER_URL)"; \
	kill $$server_pid 2>/dev/null || true; \
	exit 1
