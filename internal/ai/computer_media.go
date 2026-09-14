package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const maxComputerFrameBytes = 16 << 20

type computerMediaStore struct{ directory string }

func (s computerMediaStore) path(ref string) (string, error) {
	if !filepath.IsAbs(s.directory) || !computerFrameResourcePattern.MatchString(ref) {
		return "", errors.New("invalid computer media reference")
	}
	parts := strings.Split(strings.TrimPrefix(ref, "computer://"), "/")
	return filepath.Join(s.directory, parts[0], parts[1]+".png"), nil
}

func validateComputerFrame(attachment TargetToolAttachment, body []byte) error {
	if !computerFrameResourcePattern.MatchString(attachment.ResourceRef) || attachment.MIMEType != "image/png" || len(body) == 0 || len(body) > maxComputerFrameBytes || attachment.SizeBytes != int64(len(body)) {
		return errors.New("invalid computer frame descriptor")
	}
	sum := sha256.Sum256(body)
	hash := hex.EncodeToString(sum[:])
	if hash != attachment.SHA256 || !strings.HasSuffix(attachment.ResourceRef, "/"+hash) {
		return errors.New("computer frame content changed")
	}
	config, err := png.DecodeConfig(bytes.NewReader(body))
	if err != nil || config.Width < 1 || config.Height < 1 || config.Width > 16384 || config.Height > 16384 || int64(config.Width)*int64(config.Height) > 32<<20 {
		return errors.New("invalid computer frame dimensions")
	}
	// Decode the complete bounded image, not just its signature or header.
	if _, err := png.Decode(bytes.NewReader(body)); err != nil {
		return errors.New("invalid computer frame image")
	}
	return nil
}

func (s computerMediaStore) put(ctx context.Context, attachment TargetToolAttachment, body []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	destination, err := s.path(attachment.ResourceRef)
	if err != nil {
		return err
	}
	if err := validateComputerFrame(attachment, body); err != nil {
		return err
	}
	if _, err := os.Stat(destination); err == nil {
		_, err = s.read(ctx, attachment.ResourceRef)
		return err
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(destination), ".frame-")
	if err != nil {
		return err
	}
	defer os.Remove(temp.Name())
	if _, err := temp.Write(body); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return os.Rename(temp.Name(), destination)
}

func (s computerMediaStore) read(ctx context.Context, ref string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	path, err := s.path(ref)
	if err != nil {
		return nil, err
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	body, err := io.ReadAll(io.LimitReader(file, maxComputerFrameBytes+1))
	if err != nil {
		return nil, err
	}
	hash := ref[strings.LastIndexByte(ref, '/')+1:]
	if err := validateComputerFrame(TargetToolAttachment{ResourceRef: ref, MIMEType: "image/png", SizeBytes: int64(len(body)), SHA256: hash}, body); err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return body, nil
}
