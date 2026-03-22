package home

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/AdguardTeam/AdGuardHome/internal/aghhttp"
	"github.com/AdguardTeam/AdGuardHome/internal/version"
	"github.com/AdguardTeam/golibs/logutil/slogutil"
)

const defaultCustomUpdateStatusCommand = "/usr/local/sbin/agh-custom-status"

// customUpdateStatusCommand returns the custom update status command path.
func customUpdateStatusCommand() (path string) {
	path = strings.TrimSpace(os.Getenv("AGH_CUSTOM_UPDATE_STATUS_CMD"))
	if path != "" {
		return path
	}

	return defaultCustomUpdateStatusCommand
}

type customUpdateStatusResponse struct {
	AghVersion        string `json:"agh_version"`
	ForkConfigured    bool   `json:"fork_configured"`
	SourceDir         string `json:"source_dir,omitempty"`
	Branch            string `json:"branch,omitempty"`
	BuildVersion      string `json:"build_version,omitempty"`
	InstalledRevision string `json:"installed_revision,omitempty"`
	RemoteRevision    string `json:"remote_revision,omitempty"`
	UpdateAvailable   bool   `json:"update_available"`
	Error             string `json:"error,omitempty"`
}

// handleCustomUpdateStatus runs the custom status command and returns parsed
// status about fork updates.
func (web *webAPI) handleCustomUpdateStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	l := web.logger

	resp := &customUpdateStatusResponse{
		AghVersion: version.Version(),
	}

	cmdPath := customUpdateStatusCommand()
	fi, err := os.Stat(cmdPath)
	if err != nil {
		resp.Error = fmt.Sprintf("custom status command %q not found: %s", cmdPath, err)
		aghhttp.WriteJSONResponseOK(ctx, l, w, r, resp)

		return
	}

	if fi.IsDir() {
		resp.Error = fmt.Sprintf("custom status command %q is a directory", cmdPath)
		aghhttp.WriteJSONResponseOK(ctx, l, w, r, resp)

		return
	}

	cmdCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(cmdCtx, cmdPath)
	out, err := cmd.Output()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			resp.Error = strings.TrimSpace(string(exitErr.Stderr))
			if resp.Error == "" {
				resp.Error = exitErr.Error()
			}
		} else {
			resp.Error = err.Error()
		}

		l.ErrorContext(
			ctx,
			"custom update status command failed",
			"path",
			cmdPath,
			slogutil.KeyError,
			err,
		)
		aghhttp.WriteJSONResponseOK(ctx, l, w, r, resp)

		return
	}

	status := &customUpdateStatusResponse{}
	err = json.Unmarshal(out, status)
	if err != nil {
		resp.Error = fmt.Sprintf("parsing custom status output: %s", err)
		l.ErrorContext(
			ctx,
			"parsing custom update status output",
			"path",
			cmdPath,
			"output",
			string(out),
			slogutil.KeyError,
			err,
		)
		aghhttp.WriteJSONResponseOK(ctx, l, w, r, resp)

		return
	}

	if status.AghVersion == "" {
		status.AghVersion = version.Version()
	}

	aghhttp.WriteJSONResponseOK(ctx, l, w, r, status)
}
