package fs

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/floegence/flowersec/flowersec-go/rpc"
	rpctyped "github.com/floegence/flowersec/flowersec-go/rpc/typed"
	"github.com/floegence/redeven-agent/internal/session"
)

const (
	TypeID_FS_LIST      uint32 = 1001
	TypeID_FS_READ_FILE uint32 = 1002
	TypeID_FS_WRITE     uint32 = 1003
	TypeID_FS_RENAME    uint32 = 1004
	TypeID_FS_COPY      uint32 = 1005
	TypeID_FS_DELETE    uint32 = 1006
	TypeID_FS_GET_HOME  uint32 = 1010
)

type Service struct {
	root string
}

func NewService(root string) *Service {
	root = strings.TrimSpace(root)
	if root == "" {
		root = "."
	}
	if abs, err := filepath.Abs(root); err == nil {
		root = abs
	}
	root = filepath.Clean(root)
	return &Service{root: root}
}

func (s *Service) Register(r *rpc.Router, meta *session.Meta) {
	if r == nil || s == nil {
		return
	}

	rpctyped.Register[fsGetHomeReq, fsGetHomeResp](r, TypeID_FS_GET_HOME, func(_ctx context.Context, _ *fsGetHomeReq) (*fsGetHomeResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &rpc.Error{Code: 403, Message: "read permission denied"}
		}
		// Return the real filesystem root path configured for this agent.
		return &fsGetHomeResp{Path: s.root}, nil
	})

	rpctyped.Register[fsListReq, fsListResp](r, TypeID_FS_LIST, func(_ctx context.Context, req *fsListReq) (*fsListResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &rpc.Error{Code: 403, Message: "read permission denied"}
		}
		vp, p, err := s.resolve(req.Path)
		if err != nil {
			return nil, &rpc.Error{Code: 400, Message: "invalid path"}
		}

		ents, err := os.ReadDir(p)
		if err != nil {
			return nil, &rpc.Error{Code: 404, Message: "not found"}
		}

		showHidden := req.ShowHidden != nil && *req.ShowHidden
		out := make([]fsFileInfo, 0, len(ents))
		for _, e := range ents {
			name := e.Name()
			if !showHidden && strings.HasPrefix(name, ".") {
				continue
			}
			info, err := e.Info()
			if err != nil {
				continue
			}
			full := path.Join(vp, name)
			mod := info.ModTime()
			out = append(out, fsFileInfo{
				Name:        name,
				Path:        full,
				IsDirectory: info.IsDir(),
				Size:        info.Size(),
				ModifiedAt:  mod.UnixMilli(),
				CreatedAt:   mod.UnixMilli(),
				Permissions: fileModeString(info.Mode()),
			})
		}
		return &fsListResp{Entries: out}, nil
	})

	rpctyped.Register[fsReadFileReq, fsReadFileResp](r, TypeID_FS_READ_FILE, func(_ctx context.Context, req *fsReadFileReq) (*fsReadFileResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &rpc.Error{Code: 403, Message: "read permission denied"}
		}
		_, p, err := s.resolve(req.Path)
		if err != nil {
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

	rpctyped.Register[fsWriteFileReq, fsWriteFileResp](r, TypeID_FS_WRITE, func(_ctx context.Context, req *fsWriteFileReq) (*fsWriteFileResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &rpc.Error{Code: 403, Message: "write permission denied"}
		}
		_, p, err := s.resolve(req.Path)
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

	rpctyped.Register[fsDeleteReq, fsDeleteResp](r, TypeID_FS_DELETE, func(_ctx context.Context, req *fsDeleteReq) (*fsDeleteResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &rpc.Error{Code: 403, Message: "write permission denied"}
		}
		_, p, err := s.resolve(req.Path)
		if err != nil {
			return nil, &rpc.Error{Code: 400, Message: "invalid path"}
		}
		if req.Recursive != nil && *req.Recursive {
			if err := os.RemoveAll(p); err != nil {
				return nil, &rpc.Error{Code: 500, Message: "delete failed"}
			}
			return &fsDeleteResp{Success: true}, nil
		}
		if err := os.Remove(p); err != nil {
			return nil, &rpc.Error{Code: 500, Message: "delete failed"}
		}
		return &fsDeleteResp{Success: true}, nil
	})

	rpctyped.Register[fsRenameReq, fsRenameResp](r, TypeID_FS_RENAME, func(_ctx context.Context, req *fsRenameReq) (*fsRenameResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &rpc.Error{Code: 403, Message: "write permission denied"}
		}
		vpOld, pOld, err := s.resolve(req.OldPath)
		if err != nil {
			return nil, &rpc.Error{Code: 400, Message: "invalid old_path"}
		}
		vpNew, pNew, err := s.resolve(req.NewPath)
		if err != nil {
			return nil, &rpc.Error{Code: 400, Message: "invalid new_path"}
		}
		// Source must exist
		if _, err := os.Stat(pOld); os.IsNotExist(err) {
			return nil, &rpc.Error{Code: 404, Message: "source not found"}
		}
		// Destination must not exist (prevent accidental overwrite)
		if _, err := os.Stat(pNew); err == nil {
			return nil, &rpc.Error{Code: 409, Message: "destination already exists"}
		}
		// Ensure parent directory of destination exists
		destDir := filepath.Dir(pNew)
		if err := os.MkdirAll(destDir, 0o755); err != nil {
			return nil, &rpc.Error{Code: 500, Message: "failed to create destination directory"}
		}
		// Perform rename (works across directories)
		if err := os.Rename(pOld, pNew); err != nil {
			return nil, &rpc.Error{Code: 500, Message: "rename failed"}
		}
		_ = vpOld // suppress unused warning
		return &fsRenameResp{Success: true, NewPath: vpNew}, nil
	})

	rpctyped.Register[fsCopyReq, fsCopyResp](r, TypeID_FS_COPY, func(_ctx context.Context, req *fsCopyReq) (*fsCopyResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &rpc.Error{Code: 403, Message: "write permission denied"}
		}
		_, pSrc, err := s.resolve(req.SourcePath)
		if err != nil {
			return nil, &rpc.Error{Code: 400, Message: "invalid source_path"}
		}
		vpDest, pDest, err := s.resolve(req.DestPath)
		if err != nil {
			return nil, &rpc.Error{Code: 400, Message: "invalid dest_path"}
		}
		srcInfo, err := os.Stat(pSrc)
		if os.IsNotExist(err) {
			return nil, &rpc.Error{Code: 404, Message: "source not found"}
		}
		if err != nil {
			return nil, &rpc.Error{Code: 500, Message: "failed to stat source"}
		}
		// Check destination existence
		overwrite := req.Overwrite != nil && *req.Overwrite
		if _, err := os.Stat(pDest); err == nil && !overwrite {
			return nil, &rpc.Error{Code: 409, Message: "destination already exists"}
		}
		// Ensure parent directory of destination exists
		destDir := filepath.Dir(pDest)
		if err := os.MkdirAll(destDir, 0o755); err != nil {
			return nil, &rpc.Error{Code: 500, Message: "failed to create destination directory"}
		}
		// Copy file or directory
		if srcInfo.IsDir() {
			if err := copyDir(pSrc, pDest); err != nil {
				return nil, &rpc.Error{Code: 500, Message: "copy failed: " + err.Error()}
			}
		} else {
			if err := copyFile(pSrc, pDest); err != nil {
				return nil, &rpc.Error{Code: 500, Message: "copy failed: " + err.Error()}
			}
		}
		return &fsCopyResp{Success: true, NewPath: vpDest}, nil
	})
}

func (s *Service) resolve(p string) (virtual string, real string, err error) {
	if s == nil {
		return "", "", errors.New("nil service")
	}
	root := strings.TrimSpace(s.root)
	if root == "" {
		return "", "", errors.New("empty root")
	}

	p = strings.TrimSpace(p)
	if p == "" {
		p = "/"
	}

	// Virtual paths are always POSIX-like absolute paths starting with "/".
	// They are mapped to the configured filesystem root on the agent.
	p = strings.ReplaceAll(p, "\\", "/")
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}

	vp := path.Clean(p)
	if vp == "." {
		vp = "/"
	}
	if !strings.HasPrefix(vp, "/") {
		vp = "/" + vp
	}

	rel := strings.TrimPrefix(vp, "/")
	relOS := filepath.FromSlash(rel)
	if relOS != "" && filepath.IsAbs(relOS) {
		return "", "", errors.New("invalid absolute path")
	}

	abs := filepath.Clean(filepath.Join(root, relOS))
	ok, err := isWithinRoot(abs, root)
	if err != nil || !ok {
		return "", "", errors.New("path escapes root")
	}
	return vp, abs, nil
}

func isWithinRoot(path string, root string) (bool, error) {
	path = filepath.Clean(path)
	root = filepath.Clean(root)
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false, err
	}
	rel = filepath.Clean(rel)
	if rel == "." {
		return true, nil
	}
	if rel == ".." {
		return false, nil
	}
	if strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return false, nil
	}
	return true, nil
}

func fileModeString(m fs.FileMode) string {
	// Best-effort, stable string for UI (e.g. "-rw-r--r--").
	return m.String()
}

// --- wire types (snake_case JSON) ---

type fsGetHomeReq struct{}

type fsGetHomeResp struct {
	Path string `json:"path"`
}

type fsListReq struct {
	Path       string `json:"path"`
	ShowHidden *bool  `json:"show_hidden,omitempty"`
}

type fsListResp struct {
	Entries []fsFileInfo `json:"entries"`
}

type fsFileInfo struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	IsDirectory bool   `json:"is_directory"`
	Size        int64  `json:"size"`
	ModifiedAt  int64  `json:"modified_at"`
	CreatedAt   int64  `json:"created_at"`
	Permissions string `json:"permissions,omitempty"`
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
