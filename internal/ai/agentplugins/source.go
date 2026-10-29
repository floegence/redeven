package agentplugins

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type Source struct {
	Type       string `json:"type"`
	Directory  string `json:"directory,omitempty"`
	Repository string `json:"repository,omitempty"`
	Ref        string `json:"ref,omitempty"`
	Path       string `json:"path,omitempty"`
	Commit     string `json:"commit,omitempty"`
}

func (s Source) Key() string {
	if s.Type == "local" {
		return "local:" + s.Directory
	}
	return "github:" + strings.ToLower(s.Repository) + ":" + s.Path
}

var repositoryName = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)
var commitName = regexp.MustCompile(`^[0-9a-f]{40}$`)

func (s Source) validate() error {
	switch s.Type {
	case "local":
		if !filepath.IsAbs(s.Directory) || filepath.Clean(s.Directory) != s.Directory || strings.ContainsRune(s.Directory, 0) || s.Repository != "" || s.Ref != "" || s.Path != "" || s.Commit != "" {
			return errors.New("select an absolute directory on the runtime host")
		}
	case "github":
		if !repositoryName.MatchString(s.Repository) || s.Directory != "" || strings.Contains(s.Repository, "..") || strings.ContainsAny(s.Ref, "\x00\r\n") {
			return errors.New("invalid GitHub source")
		}
		if !portableRelativePath(s.Path) {
			return errors.New("invalid package directory")
		}
		if s.Commit != "" && !commitName.MatchString(s.Commit) {
			return errors.New("invalid commit")
		}
	default:
		return errors.New("unsupported package source")
	}
	return nil
}
func portableRelativePath(value string) bool {
	return value != "" && !strings.ContainsAny(value, "\\:\x00") && !strings.HasPrefix(value, "/") && path.Clean(value) == value && value != ".." && !strings.HasPrefix(value, "../")
}
func (s Source) Normalize() (Source, error) {
	if s.Type == "github" && s.Path == "" {
		s.Path = "."
	}
	if err := s.validate(); err != nil {
		return s, err
	}
	if s.Type == "local" {
		resolved, err := filepath.EvalSymlinks(s.Directory)
		if err != nil {
			return s, err
		}
		s.Directory = resolved
	}
	return s, nil
}

// DistributionHTTP never reaches private addresses, including through DNS or redirects.
// MCP endpoints have a separate user-configured network boundary.
func DistributionHTTP() *http.Client {
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	transport := &http.Transport{TLSHandshakeTimeout: 10 * time.Second, ResponseHeaderTimeout: 15 * time.Second, DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, e := net.SplitHostPort(address)
		if e != nil {
			return nil, e
		}
		ips, e := net.DefaultResolver.LookupIPAddr(ctx, host)
		if e != nil {
			return nil, e
		}
		for _, addr := range ips {
			ip := addr.IP
			if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
				return nil, errors.New("distribution address is not public")
			}
		}
		if len(ips) == 0 {
			return nil, errors.New("distribution address unavailable")
		}
		return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].IP.String(), port))
	}}
	return &http.Client{Timeout: 60 * time.Second, Transport: transport, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) > 3 || req.URL.Scheme != "https" || req.URL.User != nil {
			return errors.New("distribution redirect denied")
		}
		return nil
	}}
}
func get(ctx context.Context, client *http.Client, raw string, limit int64) ([]byte, error) {
	u, e := url.Parse(raw)
	if e != nil || u.Scheme != "https" || u.User != nil || u.Host == "" || u.Fragment != "" {
		return nil, errors.New("distribution requires a public HTTPS URL")
	}
	req, e := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if e != nil {
		return nil, e
	}
	req.Header.Set("User-Agent", "Redeven-Flower-Agent-Plugins")
	resp, e := client.Do(req)
	if e != nil {
		return nil, errors.New("source request failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("source returned HTTP %d", resp.StatusCode)
	}
	b, e := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if int64(len(b)) > limit {
		return nil, errors.New("source exceeds size limit")
	}
	return b, e
}
func Fetch(ctx context.Context, client *http.Client, s Source, dest string) (Source, error) {
	s, e := s.Normalize()
	if e != nil {
		return s, e
	}
	if s.Type == "local" {
		e = Snapshot(ctx, s.Directory, dest)
		return s, e
	}
	ref := s.Ref
	if ref == "" {
		ref = "HEAD"
	}
	if s.Commit != "" {
		ref = s.Commit
	}
	b, e := get(ctx, client, "https://api.github.com/repos/"+s.Repository+"/commits/"+url.PathEscape(ref), MaxConfigBytes)
	if e != nil {
		return s, e
	}
	var info struct {
		SHA string `json:"sha"`
	}
	if json.Unmarshal(b, &info) != nil || !commitName.MatchString(info.SHA) {
		return s, errors.New("invalid GitHub commit response")
	}
	s.Commit = info.SHA
	b, e = get(ctx, client, "https://api.github.com/repos/"+s.Repository+"/zipball/"+s.Commit, MaxPackageBytes)
	if e != nil {
		return s, e
	}
	temp, e := os.MkdirTemp(filepath.Dir(dest), ".github-*")
	if e != nil {
		return s, e
	}
	defer os.RemoveAll(temp)
	archive := filepath.Join(temp, "source.zip")
	if e = os.WriteFile(archive, b, 0600); e != nil {
		return s, e
	}
	zr, e := zip.OpenReader(archive)
	if e != nil {
		return s, e
	}
	defer zr.Close()
	// Count every archive entry before extraction, including directories. The
	// later snapshot limit must not permit unbounded temporary extraction first.
	if len(zr.File) > MaxFiles {
		return s, errors.New("archive exceeds limits")
	}
	expanded := filepath.Join(temp, "expanded")
	if e = os.Mkdir(expanded, 0700); e != nil {
		return s, e
	}
	extraction, e := os.OpenRoot(expanded)
	if e != nil {
		return s, e
	}
	defer extraction.Close()
	var total uint64
	first := ""
	names := map[string]bool{}
	for _, f := range zr.File {
		if e = ctx.Err(); e != nil {
			return s, e
		}
		name := f.Name
		if !portableRelativePath(strings.TrimSuffix(name, "/")) || strings.Count(name, "/") > 32 {
			return s, errors.New("unsafe archive path")
		}
		top := strings.Split(name, "/")[0]
		if first == "" {
			first = top
		}
		if first != top {
			return s, errors.New("ambiguous archive root")
		}
		fold := strings.ToLower(strings.TrimSuffix(name, "/"))
		if names[fold] {
			return s, errors.New("duplicate archive path")
		}
		names[fold] = true
		if f.Mode()&os.ModeSymlink != 0 || (!f.FileInfo().IsDir() && !f.Mode().IsRegular()) {
			return s, errors.New("unsupported archive entry")
		}
		target := filepath.FromSlash(name)
		if f.FileInfo().IsDir() {
			if e = extraction.MkdirAll(target, 0700); e != nil {
				return s, e
			}
			continue
		}
		total += f.UncompressedSize64
		if f.UncompressedSize64 > MaxFileBytes || total > MaxPackageBytes {
			return s, errors.New("archive exceeds limits")
		}
		if e = extraction.MkdirAll(filepath.Dir(target), 0700); e != nil {
			return s, e
		}
		in, err := f.Open()
		if err != nil {
			return s, err
		}
		out, err := extraction.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600|f.Mode().Perm()&0111)
		if err != nil {
			in.Close()
			return s, err
		}
		n, err := io.Copy(out, io.LimitReader(in, MaxFileBytes+1))
		in.Close()
		closeErr := out.Close()
		if err != nil {
			return s, err
		}
		if closeErr != nil {
			return s, closeErr
		}
		if n > MaxFileBytes {
			return s, errors.New("archive file exceeds limit")
		}
	}
	if first == "" {
		return s, errors.New("empty repository archive")
	}
	root := filepath.Join(expanded, first)
	selected, e := Within(root, filepath.Join(root, filepath.FromSlash(s.Path)))
	if e != nil {
		return s, e
	}
	e = Snapshot(ctx, selected, dest)
	return s, e
}

func Snapshot(ctx context.Context, root, dest string) error {
	root, e := filepath.EvalSymlinks(root)
	if e != nil {
		return e
	}
	boundary, e := os.OpenRoot(root)
	if e != nil {
		return e
	}
	defer boundary.Close()
	if e = os.Mkdir(dest, 0700); e != nil {
		return e
	}
	count := 0
	var total int64
	seen := map[string]bool{}
	var copyDir func(string, string, int) error
	copyDir = func(src, dst string, depth int) error {
		if depth > 32 {
			return errors.New("package directory depth exceeds limit")
		}
		safe, e := Within(root, src)
		if e != nil {
			return e
		}
		relative, e := filepath.Rel(root, safe)
		if e != nil {
			return e
		}
		directory, e := boundary.Open(relative)
		if e != nil {
			return e
		}
		entries, e := directory.ReadDir(-1)
		directory.Close()
		if e != nil {
			return e
		}
		for _, entry := range entries {
			if e = ctx.Err(); e != nil {
				return e
			}
			if entry.Name() == ".git" {
				continue
			}
			from := filepath.Join(safe, entry.Name())
			to := filepath.Join(dst, entry.Name())
			rel, _ := filepath.Rel(dest, to)
			fold := strings.ToLower(rel)
			if seen[fold] {
				return errors.New("package paths conflict")
			}
			seen[fold] = true
			resolved, e := Within(root, from)
			if e != nil {
				return e
			}
			st, e := os.Stat(resolved)
			if e != nil {
				return e
			}
			count++
			if count > MaxFiles {
				return errors.New("package file count exceeds limit")
			}
			if st.IsDir() {
				if e = os.Mkdir(to, 0700); e != nil {
					return e
				}
				if e = copyDir(resolved, to, depth+1); e != nil {
					return e
				}
				continue
			}
			if !st.Mode().IsRegular() || st.Size() > MaxFileBytes {
				return errors.New("unsupported package file")
			}
			total += st.Size()
			if total > MaxPackageBytes {
				return errors.New("package size exceeds limit")
			}
			relative, e := filepath.Rel(root, resolved)
			if e != nil {
				return e
			}
			in, e := boundary.Open(relative)
			if e != nil {
				return e
			}
			out, e := os.OpenFile(to, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600|st.Mode().Perm()&0111)
			if e != nil {
				in.Close()
				return e
			}
			n, err := io.Copy(out, io.LimitReader(in, MaxFileBytes+1))
			in.Close()
			syncErr := out.Sync()
			closeErr := out.Close()
			if err != nil {
				return err
			}
			if syncErr != nil {
				return syncErr
			}
			if closeErr != nil {
				return closeErr
			}
			if n != st.Size() {
				return errors.New("package changed during snapshot")
			}
		}
		return nil
	}
	return copyDir(root, dest, 0)
}
func Digest(root string) (string, error) {
	boundary, err := os.OpenRoot(root)
	if err != nil {
		return "", err
	}
	defer boundary.Close()
	h := sha256.New()
	count := 0
	var total int64
	e := filepath.WalkDir(root, func(p string, d os.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if d.IsDir() {
			return nil
		}
		st, e := d.Info()
		if e != nil {
			return e
		}
		if !st.Mode().IsRegular() {
			return errors.New("managed package is not a regular snapshot")
		}
		count++
		total += st.Size()
		if count > MaxFiles || st.Size() > MaxFileBytes || total > MaxPackageBytes {
			return errors.New("package exceeds limits")
		}
		rel, _ := filepath.Rel(root, p)
		fmt.Fprintf(h, "%s%c%d%c%d%c", filepath.ToSlash(rel), 0, st.Mode().Perm()&0111, 0, st.Size(), 0)
		f, e := boundary.Open(rel)
		if e != nil {
			return e
		}
		n, e := io.Copy(h, io.LimitReader(f, MaxFileBytes+1))
		f.Close()
		if e != nil {
			return e
		}
		if n != st.Size() {
			return errors.New("package changed during hashing")
		}
		return nil
	})
	if e != nil {
		return "", e
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
