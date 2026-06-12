package flowerhostrpc_test

import (
	"testing"

	"github.com/floegence/redeven/internal/accessrpc"
	"github.com/floegence/redeven/internal/agent"
	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/flowerhostrpc"
	"github.com/floegence/redeven/internal/fs"
	"github.com/floegence/redeven/internal/gitrepo"
	"github.com/floegence/redeven/internal/monitor"
	"github.com/floegence/redeven/internal/sys"
	"github.com/floegence/redeven/internal/terminal"
)

func TestTargetToolExecuteTypeIDIsUnique(t *testing.T) {
	t.Parallel()

	registered := map[uint32]string{
		fs.TypeID_FS_LIST:                               "fs.list",
		fs.TypeID_FS_READ_FILE:                          "fs.read_file",
		fs.TypeID_FS_WRITE:                              "fs.write",
		fs.TypeID_FS_RENAME:                             "fs.rename",
		fs.TypeID_FS_COPY:                               "fs.copy",
		fs.TypeID_FS_DELETE:                             "fs.delete",
		fs.TypeID_FS_MKDIR:                              "fs.mkdir",
		fs.TypeID_FS_GET_PATH_CONTEXT:                   "fs.get_path_context",
		gitrepo.TypeID_GIT_RESOLVE_REPO:                 "git.resolve_repo",
		gitrepo.TypeID_GIT_LIST_COMMITS:                 "git.list_commits",
		gitrepo.TypeID_GIT_GET_COMMIT_DETAIL:            "git.get_commit_detail",
		gitrepo.TypeID_GIT_GET_REPO_SUMMARY:             "git.get_repo_summary",
		gitrepo.TypeID_GIT_LIST_WORKSPACE:               "git.list_workspace",
		gitrepo.TypeID_GIT_LIST_BRANCHES:                "git.list_branches",
		gitrepo.TypeID_GIT_GET_BRANCH_DIFF:              "git.get_branch_diff",
		gitrepo.TypeID_GIT_STAGE_WORKSPACE:              "git.stage_workspace",
		gitrepo.TypeID_GIT_UNSTAGE_WORKSPACE:            "git.unstage_workspace",
		gitrepo.TypeID_GIT_COMMIT_WORKSPACE:             "git.commit_workspace",
		gitrepo.TypeID_GIT_FETCH_REPO:                   "git.fetch_repo",
		gitrepo.TypeID_GIT_PULL_REPO:                    "git.pull_repo",
		gitrepo.TypeID_GIT_PUSH_REPO:                    "git.push_repo",
		gitrepo.TypeID_GIT_CHECKOUT_BRANCH:              "git.checkout_branch",
		gitrepo.TypeID_GIT_PREVIEW_DELETE:               "git.preview_delete",
		gitrepo.TypeID_GIT_DELETE_BRANCH:                "git.delete_branch",
		gitrepo.TypeID_GIT_PREVIEW_MERGE:                "git.preview_merge",
		gitrepo.TypeID_GIT_MERGE_BRANCH:                 "git.merge_branch",
		gitrepo.TypeID_GIT_DIFF_CONTENT:                 "git.diff_content",
		gitrepo.TypeID_GIT_SWITCH_DETACHED:              "git.switch_detached",
		gitrepo.TypeID_GIT_LIST_STASHES:                 "git.list_stashes",
		gitrepo.TypeID_GIT_GET_STASH_DETAIL:             "git.get_stash_detail",
		gitrepo.TypeID_GIT_SAVE_STASH:                   "git.save_stash",
		gitrepo.TypeID_GIT_PREVIEW_APPLY:                "git.preview_apply",
		gitrepo.TypeID_GIT_APPLY_STASH:                  "git.apply_stash",
		gitrepo.TypeID_GIT_PREVIEW_DROP:                 "git.preview_drop",
		gitrepo.TypeID_GIT_DROP_STASH:                   "git.drop_stash",
		gitrepo.TypeID_GIT_LIST_WORKSPACE_PAGE:          "git.list_workspace_page",
		gitrepo.TypeID_GIT_DISCARD_WORKSPACE:            "git.discard_workspace",
		terminal.TypeID_TERMINAL_SESSION_CREATE:         "terminal.session_create",
		terminal.TypeID_TERMINAL_SESSION_LIST:           "terminal.session_list",
		terminal.TypeID_TERMINAL_SESSION_ATTACH:         "terminal.session_attach",
		terminal.TypeID_TERMINAL_OUTPUT:                 "terminal.output",
		terminal.TypeID_TERMINAL_RESIZE:                 "terminal.resize",
		terminal.TypeID_TERMINAL_INPUT:                  "terminal.input",
		terminal.TypeID_TERMINAL_HISTORY:                "terminal.history",
		terminal.TypeID_TERMINAL_CLEAR:                  "terminal.clear",
		terminal.TypeID_TERMINAL_SESSION_DELETE:         "terminal.session_delete",
		terminal.TypeID_TERMINAL_NAME_UPDATE:            "terminal.name_update",
		terminal.TypeID_TERMINAL_SESSION_STATS:          "terminal.session_stats",
		terminal.TypeID_TERMINAL_SESSIONS_CHANGED:       "terminal.sessions_changed",
		monitor.TypeID_SYS_MONITOR:                      "monitor.snapshot",
		monitor.TypeID_SYS_MONITOR_KILL_PROCESS:         "monitor.kill_process",
		sys.TypeID_SYS_PING:                             "sys.ping",
		sys.TypeID_SYS_UPGRADE:                          "sys.upgrade",
		sys.TypeID_SYS_RESTART:                          "sys.restart",
		accessrpc.TypeIDAccessStatus:                    "access.status",
		accessrpc.TypeIDAccessResume:                    "access.resume",
		agent.TypeID_SESSIONS_LIST_ACTIVE:               "agent.sessions_list_active",
		ai.TypeID_AI_SEND_USER_TURN:                     "ai.send_user_turn",
		ai.TypeID_AI_RUN_CANCEL:                         "ai.run_cancel",
		ai.TypeID_AI_SUBSCRIBE_SUMMARY:                  "ai.subscribe_summary",
		ai.TypeID_AI_EVENT_NOTIFY:                       "ai.event_notify",
		ai.TypeID_AI_TOOL_APPROVAL:                      "ai.tool_approval",
		ai.TypeID_AI_MESSAGES_LIST:                      "ai.messages_list",
		ai.TypeID_AI_ACTIVE_RUN_SNAPSHOT:                "ai.active_run_snapshot",
		ai.TypeID_AI_SUBSCRIBE_THREAD:                   "ai.subscribe_thread",
		ai.TypeID_AI_STOP_THREAD:                        "ai.stop_thread",
		ai.TypeID_AI_SUBMIT_REQUEST_USER_INPUT_RESPONSE: "ai.submit_request_user_input_response",
	}
	if owner, ok := registered[flowerhostrpc.TypeIDTargetToolExecute]; ok {
		t.Fatalf("type id %d collides with %s", flowerhostrpc.TypeIDTargetToolExecute, owner)
	}
}
