package fs

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/floegence/flowersec/flowersec-go/rpc"
	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/pathutil"
	"github.com/floegence/redeven/internal/session"
)

const (
	TypeID_FS_LIST             uint32 = 1001
	TypeID_FS_READ_FILE        uint32 = 1002
	TypeID_FS_WRITE            uint32 = 1003
	TypeID_FS_RENAME           uint32 = 1004
	TypeID_FS_COPY             uint32 = 1005
	TypeID_FS_DELETE           uint32 = 1006
	TypeID_FS_MKDIR            uint32 = 1007
	TypeID_FS_GET_PATH_CONTEXT uint32 = 1010
)

type Service struct {
	agentHomeAbs string
}

func NewService(agentHomeAbs string) *Service {
	resolved, err := pathutil.CanonicalizeExistingDirAbs(agentHomeAbs)
	if err != nil {
		panic(err)
	}
	return &Service{agentHomeAbs: resolved}
}

func (s *Service) Register(r *rpc.Router, meta *session.Meta) {
	s.RegisterWithAccessGate(r, meta, nil)
}

func (s *Service) RegisterWithAccessGate(r *rpc.Router, meta *session.Meta, gate *accessgate.Gate) {
	if r == nil || s == nil {
		return
	}

	accessgate.RegisterTyped[fsGetPathContextReq, fsGetPathContextResp](r, TypeID_FS_GET_PATH_CONTEXT, gate, meta, accessgate.RPCAccessProtected, func(_ctx context.Context, _ *fsGetPathContextReq) (*fsGetPathContextResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &rpc.Error{Code: 403, Message: "read permission denied"}
		}
		return &fsGetPathContextResp{AgentHomePathAbs: s.agentHomeAbs}, nil
	})

	accessgate.RegisterTyped[fsListReq, fsListResp](r, TypeID_FS_LIST, gate, meta, accessgate.RPCAccessProtected, func(_ctx context.Context, req *fsListReq) (*fsListResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &rpc.Error{Code: 403, Message: "read permission denied"}
		}
		showHidden := req.ShowHidden != nil && *req.ShowHidden
		out, err := s.listDirectoryEntries(req.Path, showHidden)
		if err != nil {
			if os.IsNotExist(err) {
				return nil, &rpc.Error{Code: 404, Message: "not found"}
			}
			return nil, &rpc.Error{Code: 400, Message: "invalid path"}
		}
		return &fsListResp{Entries: out}, nil
	})

	accessgate.RegisterTyped[fsReadFileReq, fsReadFileResp](r, TypeID_FS_READ_FILE, gate, meta, accessgate.RPCAccessProtected, func(_ctx context.Context, req *fsReadFileReq) (*fsReadFileResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &rpc.Error{Code: 403, Message: "read permission denied"}
		}
		p, _, err := s.resolveReadableFilePath(req.Path)
		if err != nil {
			if os.IsNotExist(err) {
				return nil, &rpc.Error{Code: 404, Message: "not found"}
			}
			if errors.Is(err, errFSPathIsDirectory) {
				return nil, &rpc.Error{Code: 400, Message: "path is a directory"}
			}
			return nil, &rpc.Error{Code: 400, Message: "invalid path"}
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return nil, &rpc.Error{Code: 404, Message: "not found"}
		}

		enc := strings.ToLower(strings.TrimSpace(req.Encoding))
		switch enc {
		case "", "utf8", "utf-8":
			return &fsReadFileResp{Content: string(b), Encoding: "utf8"}, nil
		case "base64":
			return &fsReadFileResp{Content: base64.StdEncoding.EncodeToString(b), Encoding: "base64"}, nil
		default:
			return nil, &rpc.Error{Code: 400, Message: "unsupported encoding"}
		}
	})

	accessgate.RegisterTyped[fsWriteFileReq, fsWriteFileResp](r, TypeID_FS_WRITE, gate, meta, accessgate.RPCAccessProtected, func(_ctx context.Context, req *fsWriteFileReq) (*fsWriteFileResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &rpc.Error{Code: 403, Message: "write permission denied"}
		}
		p, err := s.resolveTargetPath(req.Path)
		if err != nil {
			return nil, &rpc.Error{Code: 400, Message: "invalid path"}
		}

		if req.CreateDirs != nil && *req.CreateDirs {
			if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
				return nil, &rpc.Error{Code: 500, Message: "mkdir failed"}
			}
		}

		enc := strings.ToLower(strings.TrimSpace(req.Encoding))
		var data []byte
		switch enc {
		case "", "utf8", "utf-8":
			data = []byte(req.Content)
		case "base64":
			b, err := base64.StdEncoding.DecodeString(req.Content)
			if err != nil {
				return nil, &rpc.Error{Code: 400, Message: "invalid base64"}
			}
			data = b
		default:
			return nil, &rpc.Error{Code: 400, Message: "unsupported encoding"}
		}

		if err := os.WriteFile(p, data, 0o644); err != nil {
			return nil, &rpc.Error{Code: 500, Message: "write failed"}
		}
		return &fsWriteFileResp{Success: true}, nil
	})

	accessgate.RegisterTyped[fsMkdirReq, fsMkdirResp](r, TypeID_FS_MKDIR, gate, meta, accessgate.RPCAccessProtected, func(_ctx context.Context, req *fsMkdirReq) (*fsMkdirResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &rpc.Error{Code: 403, Message: "write permission denied"}
		}
		createParents := req.CreateParents != nil && *req.CreateParents
		if _, err := s.mkdirTarget(req.Path, createParents); err != nil {
			return nil, err
		}
		return &fsMkdirResp{Success: true}, nil
	})

	accessgate.RegisterTyped[fsDeleteReq, fsDeleteResp](r, TypeID_FS_DELETE, gate, meta, accessgate.RPCAccessProtected, func(_ctx context.Context, req *fsDeleteReq) (*fsDeleteResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &rpc.Error{Code: 403, Message: "write permission denied"}
		}
		if err := s.deleteEntry(req.Path, req.Recursive != nil && *req.Recursive); err != nil {
			if os.IsNotExist(err) {
				return nil, &rpc.Error{Code: 404, Message: "not found"}
			}
			if errors.Is(err, errFSInvalidPath) {
				return nil, &rpc.Error{Code: 400, Message: "invalid path"}
			}
			return nil, &rpc.Error{Code: 500, Message: "delete failed"}
		}
		return &fsDeleteResp{Success: true}, nil
	})

	accessgate.RegisterTyped[fsRenameReq, fsRenameResp](r, TypeID_FS_RENAME, gate, meta, accessgate.RPCAccessProtected, func(_ctx context.Context, req *fsRenameReq) (*fsRenameResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &rpc.Error{Code: 403, Message: "write permission denied"}
		}
		newPath, err := s.renameEntry(req.OldPath, req.NewPath)
		if err != nil {
			switch {
			case os.IsNotExist(err):
				return nil, &rpc.Error{Code: 404, Message: "source not found"}
			case errors.Is(err, errFSDestinationExists):
				return nil, &rpc.Error{Code: 409, Message: "destination already exists"}
			case errors.Is(err, errFSInvalidNewPath):
				return nil, &rpc.Error{Code: 400, Message: "invalid new_path"}
			case errors.Is(err, errFSInvalidOldPath):
				return nil, &rpc.Error{Code: 400, Message: "invalid old_path"}
			default:
				return nil, &rpc.Error{Code: 500, Message: "rename failed"}
			}
		}
		return &fsRenameResp{Success: true, NewPath: newPath}, nil
	})

	accessgate.RegisterTyped[fsCopyReq, fsCopyResp](r, TypeID_FS_COPY, gate, meta, accessgate.RPCAccessProtected, func(_ctx context.Context, req *fsCopyReq) (*fsCopyResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &rpc.Error{Code: 403, Message: "write permission denied"}
		}
		overwrite := req.Overwrite != nil && *req.Overwrite
		newPath, err := s.copyEntry(req.SourcePath, req.DestPath, overwrite)
		if err != nil {
			switch {
			case os.IsNotExist(err):
				return nil, &rpc.Error{Code: 404, Message: "source not found"}
			case errors.Is(err, errFSDestinationExists):
				return nil, &rpc.Error{Code: 409, Message: "destination already exists"}
			case errors.Is(err, errFSInvalidSourcePath):
				return nil, &rpc.Error{Code: 400, Message: "invalid source_path"}
			case errors.Is(err, errFSInvalidDestPath):
				return nil, &rpc.Error{Code: 400, Message: "invalid dest_path"}
			default:
				return nil, &rpc.Error{Code: 500, Message: "copy failed: " + err.Error()}
			}
		}
		return &fsCopyResp{Success: true, NewPath: newPath}, nil
	})
}

func (s *Service) resolveExistingDir(path string) (string, error) {
	if s == nil {
		return "", errors.New("nil service")
	}
	if strings.TrimSpace(path) == "" {
		path = s.agentHomeAbs
	}
	return pathutil.ResolveExistingScopedDir(path, s.agentHomeAbs)
}

func (s *Service) resolveTargetPath(path string) (string, error) {
	if s == nil {
		return "", errors.New("nil service")
	}
	if strings.TrimSpace(path) == "" {
		return "", errors.New("missing path")
	}
	return pathutil.ResolveTargetScopedPath(path, s.agentHomeAbs)
}

func (s *Service) mkdirTarget(path string, createParents bool) (string, error) {
	targetPath, err := s.resolveTargetPath(path)
	if err != nil {
		return "", &rpc.Error{Code: 400, Message: "invalid path"}
	}

	if _, err := os.Stat(targetPath); err == nil {
		return "", &rpc.Error{Code: 409, Message: "path already exists"}
	} else if !os.IsNotExist(err) {
		return "", &rpc.Error{Code: 500, Message: "failed to stat target"}
	}

	if !createParents {
		parentDir := filepath.Dir(targetPath)
		info, err := os.Stat(parentDir)
		if os.IsNotExist(err) {
			return "", &rpc.Error{Code: 404, Message: "parent directory not found"}
		}
		if err != nil {
			return "", &rpc.Error{Code: 500, Message: "failed to stat parent directory"}
		}
		if !info.IsDir() {
			return "", &rpc.Error{Code: 400, Message: "parent is not a directory"}
		}
	}

	if createParents {
		if err := os.MkdirAll(targetPath, 0o755); err != nil {
			if os.IsExist(err) {
				return "", &rpc.Error{Code: 409, Message: "path already exists"}
			}
			return "", &rpc.Error{Code: 500, Message: "mkdir failed"}
		}
		return targetPath, nil
	}

	if err := os.Mkdir(targetPath, 0o755); err != nil {
		if os.IsExist(err) {
			return "", &rpc.Error{Code: 409, Message: "path already exists"}
		}
		return "", &rpc.Error{Code: 500, Message: "mkdir failed"}
	}

	return targetPath, nil
}

func fileModeString(m fs.FileMode) string {
	// Best-effort, stable string for UI (e.g. "-rw-r--r--").
	return m.String()
}

// --- wire types (snake_case JSON) ---

type fsGetPathContextReq struct{}

type fsGetPathContextResp struct {
	AgentHomePathAbs string `json:"agent_home_path_abs"`
}

type fsListReq struct {
	Path       string `json:"path"`
	ShowHidden *bool  `json:"show_hidden,omitempty"`
}

type fsListResp struct {
	Entries []fsFileInfo `json:"entries"`
}

type fsFileInfo struct {
	Name         string `json:"name"`
	Path         string `json:"path"`
	IsDirectory  bool   `json:"is_directory"`
	EntryType    string `json:"entry_type,omitempty"`
	ResolvedType string `json:"resolved_type,omitempty"`
	Size         int64  `json:"size"`
	ModifiedAt   int64  `json:"modified_at"`
	CreatedAt    int64  `json:"created_at"`
	Permissions  string `json:"permissions,omitempty"`
}

type fsReadFileReq struct {
	Path     string `json:"path"`
	Encoding string `json:"encoding,omitempty"` // utf8|base64
}

type fsReadFileResp struct {
	Content  string `json:"content"`
	Encoding string `json:"encoding"`
}

type fsWriteFileReq struct {
	Path       string `json:"path"`
	Content    string `json:"content"`
	Encoding   string `json:"encoding,omitempty"` // utf8|base64
	CreateDirs *bool  `json:"create_dirs,omitempty"`
}

type fsWriteFileResp struct {
	Success bool `json:"success"`
}

type fsMkdirReq struct {
	Path          string `json:"path"`
	CreateParents *bool  `json:"create_parents,omitempty"`
}

type fsMkdirResp struct {
	Success bool `json:"success"`
}

type fsDeleteReq struct {
	Path      string `json:"path"`
	Recursive *bool  `json:"recursive,omitempty"`
}

type fsDeleteResp struct {
	Success bool `json:"success"`
}

type fsRenameReq struct {
	OldPath string `json:"old_path"`
	NewPath string `json:"new_path"`
}

type fsRenameResp struct {
	Success bool   `json:"success"`
	NewPath string `json:"new_path"`
}

type fsCopyReq struct {
	SourcePath string `json:"source_path"`
	DestPath   string `json:"dest_path"`
	Overwrite  *bool  `json:"overwrite,omitempty"`
}

type fsCopyResp struct {
	Success bool   `json:"success"`
	NewPath string `json:"new_path"`
}

// copyFile copies a single file from src to dst, preserving permissions.
func copyFile(src, dst string) error {
	srcFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer srcFile.Close()

	srcInfo, err := srcFile.Stat()
	if err != nil {
		return err
	}

	dstFile, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, srcInfo.Mode())
	if err != nil {
		return err
	}
	defer dstFile.Close()

	buf := make([]byte, 64*1024)
	for {
		n, err := srcFile.Read(buf)
		if n > 0 {
			if _, wErr := dstFile.Write(buf[:n]); wErr != nil {
				return wErr
			}
		}
		if err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			return err
		}
	}
	return nil
}

// copyDir recursively copies a directory from src to dst.
func copyDir(src, dst string) error {
	srcInfo, err := os.Stat(src)
	if err != nil {
		return err
	}

	if err := os.MkdirAll(dst, srcInfo.Mode()); err != nil {
		return err
	}

	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		srcPath := filepath.Join(src, entry.Name())
		dstPath := filepath.Join(dst, entry.Name())

		if entry.Type()&os.ModeSymlink != 0 {
			if err := copySymbolicLink(srcPath, dstPath, false); err != nil {
				return err
			}
			continue
		}

		if entry.IsDir() {
			if err := copyDir(srcPath, dstPath); err != nil {
				return err
			}
		} else {
			if err := copyFile(srcPath, dstPath); err != nil {
				return err
			}
		}
	}
	return nil
}
