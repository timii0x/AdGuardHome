package home

import (
	"context"
	"net/http"
	"os"
	"os/exec"
	"strings"

	"github.com/AdguardTeam/AdGuardHome/internal/aghhttp"
	"github.com/AdguardTeam/golibs/logutil/slogutil"
)

const defaultCustomUpdateCommand = "/usr/local/sbin/agh-custom-update"

// customUpdateCommand returns the custom update command path.
func customUpdateCommand() (path string) {
	path = strings.TrimSpace(os.Getenv("AGH_CUSTOM_UPDATE_CMD"))
	if path != "" {
		return path
	}

	return defaultCustomUpdateCommand
}

// handleCustomUpdate runs a custom update command in background.
func (web *webAPI) handleCustomUpdate(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	l := web.logger

	cmdPath := customUpdateCommand()
	fi, err := os.Stat(cmdPath)
	if err != nil {
		aghhttp.ErrorAndLog(
			ctx,
			l,
			r,
			w,
			http.StatusNotFound,
			"custom update command %q not found: %s",
			cmdPath,
			err,
		)

		return
	}

	if fi.IsDir() {
		aghhttp.ErrorAndLog(
			ctx,
			l,
			r,
			w,
			http.StatusBadRequest,
			"custom update command %q is a directory",
			cmdPath,
		)

		return
	}

	cmd := exec.CommandContext(context.Background(), cmdPath)
	err = cmd.Start()
	if err != nil {
		aghhttp.ErrorAndLog(
			ctx,
			l,
			r,
			w,
			http.StatusInternalServerError,
			"starting custom update command %q: %s",
			cmdPath,
			err,
		)

		return
	}

	l.InfoContext(
		ctx,
		"started custom update command",
		"path",
		cmdPath,
		"pid",
		cmd.Process.Pid,
	)
	aghhttp.OK(ctx, l, w)

	go func() {
		waitErr := cmd.Wait()
		waitCtx := context.Background()
		if waitErr != nil {
			l.ErrorContext(
				waitCtx,
				"custom update command failed",
				"path",
				cmdPath,
				slogutil.KeyError,
				waitErr,
			)

			return
		}

		l.InfoContext(waitCtx, "custom update command finished", "path", cmdPath)
	}()
}
