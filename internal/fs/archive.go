package fs

import (
	"archive/tar"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/bodgit/sevenzip"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/gitruntime"
	"github.com/mholt/archives"
	"github.com/nwaples/rardecode/v2"
	yekazip "github.com/yeka/zip"
)

const (
	archiveStagingPrefix = ".redeven-extract-"

	archiveResultDirectory = "directory"
	archiveResultFile      = "file"
)

var (
	errArchiveUnsupportedFormat = errors.New("unsupported archive format")
	errArchiveMultipart         = errors.New("multipart archive is unsupported")
	errArchivePasswordRequired  = errors.New("archive password required")
	errArchiveWrongPassword     = errors.New("archive password is incorrect")
	errArchiveUnsafeEntry       = errors.New("unsafe archive entry")
	errArchiveUnsupportedEntry  = errors.New("unsupported archive entry type")
	errArchiveCorrupt           = errors.New("archive is corrupt")
	errArchiveResourceLimit     = errors.New("archive extraction resource limit")
	errArchiveNoSpace           = errors.New("insufficient disk space")
	errArchiveCleanup           = errors.New("archive staging cleanup failed")
	errArchiveDestinationExists = errors.New("archive destination exists")
)

type archiveExtractionResult struct {
	DestinationPath string
	ResultKind      string
	ArchiveFormat   string
}

type archiveNodeKind uint8

const (
	archiveNodeDirectory archiveNodeKind = iota + 1
	archiveNodeFile
	archiveNodeSymlink
	archiveNodeHardlink
)

type archiveNode struct {
	kind       archiveNodeKind
	target     string
	mode       os.FileMode
	explicit   bool
	modifiedAt time.Time
}

type archiveEntry struct {
	name       string
	mode       os.FileMode
	modifiedAt time.Time
	linkTarget string
	hardlink   bool
	open       func() (io.ReadCloser, error)
}

type archiveTreeWriter struct {
	ctx   context.Context
	root  string
	nodes map[string]archiveNode
	dirs  []string
	links []string
}

func (s *Service) extractArchive(
	ctx context.Context,
	sourcePath string,
	destinationParentPath string,
	destinationName string,
	password string,
) (archiveExtractionResult, error) {
	if err := validateArchiveDestinationName(destinationName); err != nil {
		return archiveExtractionResult{}, err
	}
	source, _, err := s.resolveReadableFilePath(sourcePath)
	if err != nil {
		return archiveExtractionResult{}, err
	}
	destinationParent, err := s.scope.Resolve(destinationParentPath, filesystemscope.ResolveOptions{
		RequireExisting: true,
		RequireDir:      true,
		ForWrite:        true,
	})
	if err != nil {
		return archiveExtractionResult{}, err
	}

	var result archiveExtractionResult
	err = s.coordinateMutation(ctx, gitruntime.FilesystemEffect{
		Paths:           []string{source, destinationParent.RealAbs},
		ChangesTopology: true,
	}, func() error {
		var extractErr error
		result, extractErr = extractArchiveResolved(ctx, source, destinationParent.RealAbs, destinationName, password)
		return extractErr
	})
	return result, err
}

func validateArchiveDestinationName(name string) error {
	if name == "" || strings.TrimSpace(name) != name || strings.ContainsRune(name, '\x00') ||
		name == "." || name == ".." || filepath.Base(name) != name ||
		strings.ContainsAny(name, `/\\`) || filepath.VolumeName(name) != "" || archivePathIsAbsolute(name) {
		return fmt.Errorf("invalid archive destination name")
	}
	return nil
}

func extractArchiveResolved(
	ctx context.Context,
	sourcePath string,
	destinationParent string,
	destinationName string,
	password string,
) (result archiveExtractionResult, retErr error) {
	if err := ctx.Err(); err != nil {
		return result, err
	}
	source, err := os.Open(sourcePath)
	if err != nil {
		return result, err
	}
	defer source.Close()

	format, reader, err := archives.Identify(ctx, "", source)
	if err != nil {
		if errors.Is(err, archives.NoMatch) {
			return result, errArchiveUnsupportedFormat
		}
		return result, classifyArchiveLibraryError(err, password != "", false)
	}
	identified, err := identifySupportedArchive(format, password)
	if err != nil {
		return result, err
	}
	if identified.container && multipartArchiveName(sourcePath) {
		return result, errArchiveMultipart
	}

	if identified.container {
		staging, err := os.MkdirTemp(destinationParent, archiveStagingPrefix)
		if err != nil {
			return result, classifyArchiveIOError(err)
		}
		if err := os.Chmod(staging, 0o700); err != nil {
			_ = os.RemoveAll(staging)
			return result, classifyArchiveIOError(err)
		}
		published := false
		defer func() {
			if published {
				return
			}
			if err := os.RemoveAll(staging); err != nil {
				retErr = fmt.Errorf("%w: %v", errArchiveCleanup, err)
			}
		}()

		writer := &archiveTreeWriter{
			ctx:   ctx,
			root:  staging,
			nodes: make(map[string]archiveNode),
		}
		if err := identified.extract(ctx, reader, writer); err != nil {
			return result, classifyArchiveLibraryError(err, password != "", false)
		}
		if err := writer.finish(); err != nil {
			return result, err
		}
		destinationPath, err := publishArchiveStaging(staging, destinationParent, destinationName, true)
		if err != nil {
			return result, classifyArchiveIOError(err)
		}
		published = true
		return archiveExtractionResult{
			DestinationPath: destinationPath,
			ResultKind:      archiveResultDirectory,
			ArchiveFormat:   identified.name,
		}, nil
	}

	staging, err := os.CreateTemp(destinationParent, archiveStagingPrefix)
	if err != nil {
		return result, classifyArchiveIOError(err)
	}
	stagingPath := staging.Name()
	published := false
	defer func() {
		if published {
			return
		}
		if err := os.Remove(stagingPath); err != nil && !errors.Is(err, os.ErrNotExist) {
			retErr = fmt.Errorf("%w: %v", errArchiveCleanup, err)
		}
	}()
	if err := staging.Chmod(0o600); err != nil {
		_ = staging.Close()
		return result, classifyArchiveIOError(err)
	}
	decompressed, err := identified.decompress(reader)
	if err != nil {
		_ = staging.Close()
		return result, classifyArchiveLibraryError(err, password != "", false)
	}
	_, copyErr := io.Copy(staging, contextReader{ctx: ctx, reader: decompressed})
	closeDecompressErr := decompressed.Close()
	closeStagingErr := staging.Close()
	if copyErr != nil {
		return result, classifyArchiveLibraryError(copyErr, password != "", false)
	}
	if closeDecompressErr != nil {
		return result, classifyArchiveLibraryError(closeDecompressErr, password != "", false)
	}
	if closeStagingErr != nil {
		return result, classifyArchiveIOError(closeStagingErr)
	}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	destinationPath, err := publishArchiveStaging(stagingPath, destinationParent, destinationName, false)
	if err != nil {
		return result, classifyArchiveIOError(err)
	}
	published = true
	return archiveExtractionResult{
		DestinationPath: destinationPath,
		ResultKind:      archiveResultFile,
		ArchiveFormat:   identified.name,
	}, nil
}

type supportedArchive struct {
	name       string
	container  bool
	extract    func(context.Context, io.Reader, *archiveTreeWriter) error
	decompress func(io.Reader) (io.ReadCloser, error)
}

func identifySupportedArchive(format archives.Format, password string) (supportedArchive, error) {
	switch typed := format.(type) {
	case archives.Zip:
		return supportedArchive{
			name:      "zip",
			container: true,
			extract: func(ctx context.Context, reader io.Reader, writer *archiveTreeWriter) error {
				return extractZipArchive(ctx, reader, password, writer)
			},
		}, nil
	case archives.SevenZip:
		typed.Password = password
		return extractorArchive("7z", typed), nil
	case archives.Rar:
		typed.Password = password
		return extractorArchive("rar", typed), nil
	case archives.Tar:
		return extractorArchive("tar", typed), nil
	case archives.CompressedArchive:
		if _, ok := typed.Extraction.(archives.Tar); !ok {
			return supportedArchive{}, errArchiveUnsupportedFormat
		}
		compressionName, ok := supportedCompressionName(typed.Compression)
		if !ok {
			return supportedArchive{}, errArchiveUnsupportedFormat
		}
		return extractorArchive("tar."+compressionName, typed), nil
	case archives.Gz:
		return decompressorArchive("gz", typed), nil
	case archives.Bz2:
		return decompressorArchive("bz2", typed), nil
	case archives.Xz:
		return decompressorArchive("xz", typed), nil
	case archives.Zstd:
		return decompressorArchive("zst", typed), nil
	default:
		return supportedArchive{}, errArchiveUnsupportedFormat
	}
}

func extractorArchive(name string, extractor archives.Extractor) supportedArchive {
	return supportedArchive{
		name:      name,
		container: true,
		extract: func(ctx context.Context, reader io.Reader, writer *archiveTreeWriter) error {
			return extractor.Extract(ctx, reader, func(_ context.Context, info archives.FileInfo) error {
				entry := archiveEntry{
					name:       info.NameInArchive,
					mode:       info.Mode(),
					modifiedAt: info.ModTime(),
					linkTarget: info.LinkTarget,
					open: func() (io.ReadCloser, error) {
						file, err := info.Open()
						if err != nil {
							return nil, err
						}
						return file, nil
					},
				}
				if header, ok := info.Header.(*tar.Header); ok && header.Typeflag == tar.TypeLink {
					entry.hardlink = true
					entry.linkTarget = header.Linkname
				}
				return writer.add(entry)
			})
		},
	}
}

func decompressorArchive(name string, decompressor archives.Decompressor) supportedArchive {
	return supportedArchive{name: name, decompress: decompressor.OpenReader}
}

func supportedCompressionName(compression archives.Compression) (string, bool) {
	switch compression.(type) {
	case archives.Gz:
		return "gz", true
	case archives.Bz2:
		return "bz2", true
	case archives.Xz:
		return "xz", true
	case archives.Zstd:
		return "zst", true
	default:
		return "", false
	}
}

func multipartArchiveName(filename string) bool {
	name := strings.ToLower(filepath.Base(filename))
	if strings.HasSuffix(name, ".001") || strings.HasSuffix(name, ".r00") {
		return true
	}
	if index := strings.LastIndex(name, ".part"); index >= 0 {
		rest := name[index+len(".part"):]
		digitCount := 0
		for digitCount < len(rest) && rest[digitCount] >= '0' && rest[digitCount] <= '9' {
			digitCount++
		}
		return digitCount > 0 && rest[digitCount:] == ".rar"
	}
	return false
}

func (writer *archiveTreeWriter) add(entry archiveEntry) error {
	if err := writer.ctx.Err(); err != nil {
		return err
	}
	rel, err := normalizeArchiveEntryPath(entry.name)
	if err != nil {
		return err
	}

	kind := archiveNodeFile
	switch {
	case entry.hardlink:
		kind = archiveNodeHardlink
	case entry.mode&os.ModeSymlink != 0:
		kind = archiveNodeSymlink
	case entry.mode.IsDir():
		kind = archiveNodeDirectory
	case entry.mode.Type() != 0:
		return fmt.Errorf("%w: %s", errArchiveUnsupportedEntry, entry.name)
	}
	if rel == "" {
		if kind == archiveNodeDirectory {
			return nil
		}
		return fmt.Errorf("%w: empty entry path", errArchiveUnsafeEntry)
	}
	if err := writer.ensureParents(rel); err != nil {
		return err
	}
	existing, existed := writer.nodes[rel]
	if existed {
		if existing.kind != archiveNodeDirectory || kind != archiveNodeDirectory || existing.explicit {
			return fmt.Errorf("%w: duplicate or conflicting path %s", errArchiveUnsafeEntry, rel)
		}
	}

	node := archiveNode{kind: kind, mode: safeArchiveMode(entry.mode, kind), explicit: true, modifiedAt: entry.modifiedAt}
	if kind == archiveNodeDirectory {
		writer.nodes[rel] = node
		writer.dirs = append(writer.dirs, rel)
		if existed {
			return nil
		}
		if err := os.Mkdir(writer.diskPath(rel), 0o700); err != nil {
			if errors.Is(err, os.ErrExist) {
				return fmt.Errorf("%w: filesystem path collision %s", errArchiveUnsafeEntry, rel)
			}
			return err
		}
		return nil
	}
	if kind == archiveNodeSymlink || kind == archiveNodeHardlink {
		target := entry.linkTarget
		if target == "" && kind == archiveNodeSymlink {
			if entry.open == nil {
				return fmt.Errorf("%w: missing symlink target", errArchiveUnsafeEntry)
			}
			opened, err := entry.open()
			if err != nil {
				return err
			}
			contents, readErr := io.ReadAll(contextReader{ctx: writer.ctx, reader: opened})
			closeErr := opened.Close()
			if readErr != nil {
				return readErr
			}
			if closeErr != nil {
				return closeErr
			}
			target = string(contents)
		}
		targetRel, err := normalizeArchiveLinkTarget(rel, target, kind == archiveNodeHardlink)
		if err != nil {
			return err
		}
		node.target = targetRel
		writer.nodes[rel] = node
		writer.links = append(writer.links, rel)
		return nil
	}
	if entry.open == nil {
		return fmt.Errorf("%w: missing file content", errArchiveCorrupt)
	}
	opened, err := entry.open()
	if err != nil {
		return err
	}
	destination, err := os.OpenFile(writer.diskPath(rel), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		_ = opened.Close()
		if errors.Is(err, os.ErrExist) {
			return fmt.Errorf("%w: filesystem path collision %s", errArchiveUnsafeEntry, rel)
		}
		return err
	}
	_, copyErr := io.Copy(destination, contextReader{ctx: writer.ctx, reader: opened})
	closeSourceErr := opened.Close()
	closeDestinationErr := destination.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeSourceErr != nil {
		return closeSourceErr
	}
	if closeDestinationErr != nil {
		return closeDestinationErr
	}
	writer.nodes[rel] = node
	if err := os.Chmod(writer.diskPath(rel), node.mode); err != nil {
		return err
	}
	if !node.modifiedAt.IsZero() {
		if err := os.Chtimes(writer.diskPath(rel), node.modifiedAt, node.modifiedAt); err != nil {
			return err
		}
	}
	return nil
}

func (writer *archiveTreeWriter) ensureParents(rel string) error {
	parent := path.Dir(rel)
	if parent == "." {
		return nil
	}
	parts := strings.Split(parent, "/")
	for index := range parts {
		candidate := strings.Join(parts[:index+1], "/")
		if node, exists := writer.nodes[candidate]; exists {
			if node.kind != archiveNodeDirectory {
				return fmt.Errorf("%w: non-directory parent %s", errArchiveUnsafeEntry, candidate)
			}
			continue
		}
		writer.nodes[candidate] = archiveNode{kind: archiveNodeDirectory, mode: 0o755}
		writer.dirs = append(writer.dirs, candidate)
		if err := os.Mkdir(writer.diskPath(candidate), 0o700); err != nil {
			if errors.Is(err, os.ErrExist) {
				return fmt.Errorf("%w: filesystem path collision %s", errArchiveUnsafeEntry, candidate)
			}
			return err
		}
	}
	return nil
}

func (writer *archiveTreeWriter) finish() error {
	for _, rel := range writer.links {
		if _, err := writer.resolveFinalTarget(rel, make(map[string]bool)); err != nil {
			return err
		}
	}
	for _, rel := range writer.links {
		node := writer.nodes[rel]
		if node.kind != archiveNodeHardlink {
			continue
		}
		resolved, err := writer.resolveFinalTarget(rel, make(map[string]bool))
		if err != nil {
			return err
		}
		if writer.nodes[resolved].kind != archiveNodeFile {
			return fmt.Errorf("%w: hard link target is not a file", errArchiveUnsafeEntry)
		}
		if err := os.Link(writer.diskPath(resolved), writer.diskPath(rel)); err != nil {
			if errors.Is(err, os.ErrExist) {
				return fmt.Errorf("%w: filesystem path collision %s", errArchiveUnsafeEntry, rel)
			}
			return err
		}
	}
	for _, rel := range writer.links {
		node := writer.nodes[rel]
		if node.kind != archiveNodeSymlink {
			continue
		}
		if _, err := writer.resolveFinalTarget(rel, make(map[string]bool)); err != nil {
			return err
		}
		target, err := filepath.Rel(filepath.Dir(writer.diskPath(rel)), writer.diskPath(node.target))
		if err != nil {
			return err
		}
		if err := os.Symlink(target, writer.diskPath(rel)); err != nil {
			if errors.Is(err, os.ErrExist) {
				return fmt.Errorf("%w: filesystem path collision %s", errArchiveUnsafeEntry, rel)
			}
			return err
		}
	}
	sort.SliceStable(writer.dirs, func(i, j int) bool {
		return strings.Count(writer.dirs[i], "/") > strings.Count(writer.dirs[j], "/")
	})
	seen := make(map[string]bool, len(writer.dirs))
	for _, rel := range writer.dirs {
		if seen[rel] {
			continue
		}
		seen[rel] = true
		node := writer.nodes[rel]
		if err := os.Chmod(writer.diskPath(rel), safeArchiveMode(node.mode, archiveNodeDirectory)); err != nil {
			return err
		}
		if !node.modifiedAt.IsZero() {
			if err := os.Chtimes(writer.diskPath(rel), node.modifiedAt, node.modifiedAt); err != nil {
				return err
			}
		}
	}
	return writer.ctx.Err()
}

func (writer *archiveTreeWriter) resolveFinalTarget(rel string, visiting map[string]bool) (string, error) {
	if visiting[rel] {
		return "", fmt.Errorf("%w: link cycle", errArchiveUnsafeEntry)
	}
	visiting[rel] = true
	defer delete(visiting, rel)
	node, exists := writer.nodes[rel]
	if !exists {
		return "", fmt.Errorf("%w: link target does not exist", errArchiveUnsafeEntry)
	}
	if node.kind != archiveNodeSymlink && node.kind != archiveNodeHardlink {
		return rel, nil
	}
	target := node.target
	for {
		parts := strings.Split(target, "/")
		followed := false
		for index := range parts {
			prefix := strings.Join(parts[:index+1], "/")
			candidate, ok := writer.nodes[prefix]
			if !ok {
				return "", fmt.Errorf("%w: link target does not exist", errArchiveUnsafeEntry)
			}
			if candidate.kind != archiveNodeSymlink && candidate.kind != archiveNodeHardlink {
				continue
			}
			remaining := strings.Join(parts[index+1:], "/")
			target = path.Clean(path.Join(candidate.target, remaining))
			if target == ".." || strings.HasPrefix(target, "../") {
				return "", fmt.Errorf("%w: link target escapes output", errArchiveUnsafeEntry)
			}
			resolved, err := writer.resolveFinalTarget(prefix, visiting)
			if err != nil {
				return "", err
			}
			target = path.Clean(path.Join(resolved, remaining))
			followed = true
			break
		}
		if !followed {
			break
		}
	}
	finalNode, exists := writer.nodes[target]
	if !exists || finalNode.kind == archiveNodeSymlink || finalNode.kind == archiveNodeHardlink {
		return "", fmt.Errorf("%w: link target does not resolve", errArchiveUnsafeEntry)
	}
	return target, nil
}

func (writer *archiveTreeWriter) diskPath(rel string) string {
	return filepath.Join(writer.root, filepath.FromSlash(rel))
}

func normalizeArchiveEntryPath(name string) (string, error) {
	if strings.ContainsRune(name, '\x00') || archivePathIsAbsolute(name) {
		return "", fmt.Errorf("%w: invalid path", errArchiveUnsafeEntry)
	}
	normalized := strings.ReplaceAll(name, "\\", "/")
	cleaned := path.Clean(normalized)
	if cleaned == "." {
		return "", nil
	}
	if cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", fmt.Errorf("%w: path escapes output", errArchiveUnsafeEntry)
	}
	return cleaned, nil
}

func normalizeArchiveLinkTarget(linkPath string, target string, hardlink bool) (string, error) {
	if target == "" || strings.ContainsRune(target, '\x00') || archivePathIsAbsolute(target) {
		return "", fmt.Errorf("%w: invalid link target", errArchiveUnsafeEntry)
	}
	target = strings.ReplaceAll(target, "\\", "/")
	var targetRel string
	if hardlink {
		targetRel = path.Clean(target)
	} else {
		targetRel = path.Clean(path.Join(path.Dir(linkPath), target))
	}
	if targetRel == "." || targetRel == ".." || strings.HasPrefix(targetRel, "../") {
		return "", fmt.Errorf("%w: link target escapes output", errArchiveUnsafeEntry)
	}
	return targetRel, nil
}

func archivePathIsAbsolute(value string) bool {
	normalized := strings.ReplaceAll(value, "\\", "/")
	if strings.HasPrefix(normalized, "/") || strings.HasPrefix(normalized, "//") {
		return true
	}
	return len(normalized) >= 2 && normalized[1] == ':' &&
		((normalized[0] >= 'a' && normalized[0] <= 'z') || (normalized[0] >= 'A' && normalized[0] <= 'Z'))
}

func safeArchiveMode(mode os.FileMode, kind archiveNodeKind) os.FileMode {
	permissions := mode.Perm()
	if permissions == 0 {
		if kind == archiveNodeDirectory {
			return 0o755
		}
		return 0o644
	}
	return permissions
}

func publishArchiveStaging(staging string, parent string, name string, directory bool) (string, error) {
	for suffix := 1; ; suffix++ {
		candidateName := archiveCollisionName(name, suffix, directory)
		candidate := filepath.Join(parent, candidateName)
		err := renameNoReplace(staging, candidate)
		if err == nil {
			return candidate, nil
		}
		if !errors.Is(err, errArchiveDestinationExists) {
			return "", err
		}
	}
}

func archiveCollisionName(name string, suffix int, directory bool) string {
	if suffix == 1 {
		return name
	}
	label := fmt.Sprintf(" (%d)", suffix)
	if directory {
		return name + label
	}
	extension := filepath.Ext(name)
	if extension == name {
		extension = ""
	}
	return strings.TrimSuffix(name, extension) + label + extension
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (reader contextReader) Read(buffer []byte) (int, error) {
	if err := reader.ctx.Err(); err != nil {
		return 0, err
	}
	read, err := reader.reader.Read(buffer)
	if err == nil {
		if contextErr := reader.ctx.Err(); contextErr != nil {
			return read, contextErr
		}
	}
	return read, err
}

func classifyArchiveLibraryError(err error, passwordProvided bool, encrypted bool) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	if errors.Is(err, errArchiveUnsupportedFormat) || errors.Is(err, errArchiveMultipart) ||
		errors.Is(err, errArchivePasswordRequired) || errors.Is(err, errArchiveWrongPassword) ||
		errors.Is(err, errArchiveUnsafeEntry) || errors.Is(err, errArchiveUnsupportedEntry) ||
		errors.Is(err, errArchiveResourceLimit) || errors.Is(err, errArchiveNoSpace) ||
		errors.Is(err, errArchiveCleanup) {
		return err
	}
	if errors.Is(err, rardecode.ErrMultiVolume) || errors.Is(err, rardecode.ErrFileNameRequired) {
		return errArchiveMultipart
	}
	if errors.Is(err, yekazip.ErrPassword) || errors.Is(err, yekazip.ErrDecryption) ||
		errors.Is(err, rardecode.ErrBadPassword) {
		if passwordProvided {
			return errArchiveWrongPassword
		}
		return errArchivePasswordRequired
	}
	if errors.Is(err, rardecode.ErrArchiveEncrypted) || errors.Is(err, rardecode.ErrArchivedFileEncrypted) {
		if passwordProvided {
			return errArchiveWrongPassword
		}
		return errArchivePasswordRequired
	}
	var sevenZipErr *sevenzip.ReadError
	if errors.As(err, &sevenZipErr) && sevenZipErr.Encrypted {
		if passwordProvided {
			return errArchiveWrongPassword
		}
		return errArchivePasswordRequired
	}
	if encrypted {
		if passwordProvided {
			return errArchiveWrongPassword
		}
		return errArchivePasswordRequired
	}
	if classified := classifyArchiveIOError(err); !errors.Is(classified, err) {
		return classified
	}
	return fmt.Errorf("%w: %v", errArchiveCorrupt, err)
}

func classifyArchiveIOError(err error) error {
	switch {
	case errors.Is(err, syscall.ENOSPC), errors.Is(err, syscall.EDQUOT):
		return errArchiveNoSpace
	case errors.Is(err, syscall.ENOMEM), errors.Is(err, gitruntime.ErrResourceLimit):
		return errArchiveResourceLimit
	default:
		return err
	}
}
