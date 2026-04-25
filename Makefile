.PHONY: viz

VISUALIZER_URL ?= http://127.0.0.1:5173

viz:
	@echo "Starting benchmark visualizer at $(VISUALIZER_URL)"
	@cd tools/benchmark-visualizer && npm run dev -- --host 127.0.0.1 & \
	server_pid=$$!; \
	sleep 2; \
	open "$(VISUALIZER_URL)"; \
	wait $$server_pid
