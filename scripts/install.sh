#!/bin/sh
# Redeven CLI Installation Script
#
# This script downloads and installs the latest Redeven agent binary
# from the floegence/redeven-agent GitHub repository.
#
# Usage: curl -fsSL https://example.invalid/install.sh | sh
#
# Optional:
#   REDEVEN_VERSION=v1.2.3 curl -fsSL https://example.invalid/install.sh | sh
#
# The script will:
# 1. Detect your OS and architecture
# 2. Resolve target version from https://version.agent.example.invalid/v1/manifest.json
#    (or REDEVEN_VERSION when explicitly provided)
# 3. Download the release package and release checksums with fallback support:
#    - Primary: GitHub releases
#    - Fallback: external delivery CDN (agent.package.example.invalid)
# 4. Verify checksum + signature before extraction
# 5. Install to /usr/local/bin/redeven (or ~/.redeven/bin/redeven)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# GitHub repository for releases
GITHUB_REPO="floegence/redeven-agent"
GITHUB_RELEASES_URL="https://github.com/${GITHUB_REPO}/releases"

# Binary name
BINARY_NAME="redeven"

# Redeven home directory - config is written to ~/.redeven/config.json (default)
REDEVEN_HOME="${HOME}/.redeven"

# Install mode:
# - install (default): install flow (configure PATH, print onboarding)
# - upgrade: upgrade-only flow (skip PATH changes and onboarding)
REDEVEN_INSTALL_MODE="${REDEVEN_INSTALL_MODE:-install}"

# Optional explicit target version (for deterministic install/rollback)
REDEVEN_VERSION="${REDEVEN_VERSION:-}"

# Version metadata endpoint (must be HTTPS)
VERSION_MANIFEST_URL="https://version.agent.example.invalid/v1/manifest.json"

# Cosign identity constraint for SHA256SUMS signature verification.
COSIGN_CERT_IDENTITY_REGEXP='^https://github.com/floegence/redeven-agent/.github/workflows/release\.yml@refs/tags/v.*$'
COSIGN_CERT_OIDC_ISSUER='https://token.actions.githubusercontent.com'

# Installation directories
INSTALL_DIR="${REDEVEN_HOME}/bin"

# Logging functions
log_info() {
    printf "${GREEN}[INFO]${NC} %s\n" "$1"
}

log_warn() {
    printf "${YELLOW}[WARN]${NC} %s\n" "$1"
}

log_error() {
    printf "${RED}[ERROR]${NC} %s\n" "$1"
}

validate_release_version() {
    case "$1" in
        v[0-9]*.[0-9]*.[0-9]*|v[0-9]*.[0-9]*.[0-9]*-[0-9A-Za-z.-]*|v[0-9]*.[0-9]*.[0-9]*+[0-9A-Za-z.-]*|v[0-9]*.[0-9]*.[0-9]*-[0-9A-Za-z.-]*+[0-9A-Za-z.-]*)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

# Determine the best installation directory
determine_install_dir() {
    log_info "Determining installation directory..."

    # Forced install directory: used for agent self-upgrade to ensure we overwrite the currently running binary path.
    if [ -n "${REDEVEN_INSTALL_DIR:-}" ]; then
        INSTALL_DIR="$REDEVEN_INSTALL_DIR"
        log_info "Using forced install directory: $INSTALL_DIR"
        return 0
    fi

    # Preferred directories in order of priority:
    # 1. /usr/local/bin - system-wide, already in PATH, requires write permission or sudo
    # 2. ~/.redeven/bin - user-local, needs PATH configuration

    # Check if we can write to /usr/local/bin
    if [ -w "/usr/local/bin" ] || [ -w "/usr/local" ]; then
        INSTALL_DIR="/usr/local/bin"
        log_info "Using system directory: $INSTALL_DIR (already in PATH)"
        return 0
    fi

    # Check if we have sudo and user wants to use it
    if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
        INSTALL_DIR="/usr/local/bin"
        log_info "Using system directory with sudo: $INSTALL_DIR (already in PATH)"
        return 0
    fi

    # Fall back to user directory
    INSTALL_DIR="${REDEVEN_HOME}/bin"
    log_info "Using user directory: $INSTALL_DIR (will configure PATH)"
    return 0
}

# Check if running in a supported shell environment
check_environment() {
    log_info "Checking environment..."

    # Check if we can execute shell scripts
    if [ -z "$SHELL" ]; then
        log_error "Cannot determine shell environment"
        exit 1
    fi

    # Check for required commands
    for cmd in curl uname tar grep sed awk mktemp; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            log_error "Required command not found: $cmd"
            exit 1
        fi
    done

    log_info "Environment check passed"
}

# Detect operating system and architecture
detect_platform() {
    log_info "Detecting platform..."

    OS=$(uname -s | tr '[:upper:]' '[:lower:]')
    ARCH=$(uname -m)

    # Normalize OS name
    case "$OS" in
        linux*)
            OS="linux"
            ;;
        darwin*)
            OS="darwin"
            ;;
        msys*|mingw*|cygwin*)
            log_error "Windows native is not supported."
            log_error "Please use WSL (Windows Subsystem for Linux) to run Redeven agent."
            log_error ""
            log_error "To install WSL, run in PowerShell as Administrator:"
            log_error "  wsl --install"
            log_error ""
            log_error "Then run this installation script inside WSL."
            exit 1
            ;;
        *)
            log_error "Unsupported operating system: $OS"
            exit 1
            ;;
    esac

    # Normalize architecture name
    case "$ARCH" in
        x86_64|amd64)
            ARCH="amd64"
            ;;
        aarch64|arm64)
            ARCH="arm64"
            ;;
        armv7l|armv6l)
            ARCH="arm"
            ;;
        i386|i686)
            ARCH="386"
            ;;
        *)
            log_error "Unsupported architecture: $ARCH"
            exit 1
            ;;
    esac

    PLATFORM="${OS}_${ARCH}"
    PACKAGE_NAME="${BINARY_NAME}_${PLATFORM}.tar.gz"
    log_info "Detected platform: $PLATFORM"
}

resolve_target_version() {
    if [ -n "$REDEVEN_VERSION" ]; then
        if ! validate_release_version "$REDEVEN_VERSION"; then
            log_error "Invalid REDEVEN_VERSION: $REDEVEN_VERSION"
            log_error "Expected release tag format like v1.2.3"
            exit 1
        fi
        LATEST_VERSION="$REDEVEN_VERSION"
        VERSION_SOURCE="explicit"
        log_info "Using explicit target version: $LATEST_VERSION"
        return 0
    fi

    resolve_version_from_manifest
}

sha256_file() {
    target="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$target" | awk '{print $1}'
        return 0
    fi
    if command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$target" | awk '{print $1}'
        return 0
    fi
    log_error "Neither sha256sum nor shasum is available for checksum verification"
    exit 1
}

verify_signature() {
    checksums_file="$1"
    sig_file="$2"
    cert_file="$3"

    if ! command -v cosign >/dev/null 2>&1; then
        log_error "cosign is required to verify release signatures"
        log_error "Install cosign first: https://docs.sigstore.dev/cosign/system_config/installation/"
        exit 1
    fi

    log_info "Verifying release signature..."
    if ! cosign verify-blob \
        --certificate "$cert_file" \
        --signature "$sig_file" \
        --certificate-identity-regexp "$COSIGN_CERT_IDENTITY_REGEXP" \
        --certificate-oidc-issuer "$COSIGN_CERT_OIDC_ISSUER" \
        "$checksums_file" >/dev/null 2>&1; then
        log_error "Signature verification failed"
        exit 1
    fi
    log_info "Signature verification passed"
}

verify_checksum() {
    checksums_file="$1"
    archive_file="$2"

    expected=$(awk -v f="$PACKAGE_NAME" '$2 == f || $2 == "*" f {print $1; exit}' "$checksums_file" | tr -d '\r\n')
    if [ -z "$expected" ]; then
        log_error "Checksum entry not found for $PACKAGE_NAME"
        exit 1
    fi

    actual=$(sha256_file "$archive_file" | tr -d '\r\n')

    if [ "$actual" != "$expected" ]; then
        log_error "Checksum mismatch for $PACKAGE_NAME"
        log_error "Expected: $expected"
        log_error "Actual:   $actual"
        exit 1
    fi
    log_info "Checksum verification passed"
}

download_with_fallback() {
    primary_url="$1"
    fallback_url="$2"
    out_file="$3"

    if curl -fsSL "$primary_url" -o "$out_file"; then
        return 0
    fi

    log_warn "Primary download failed, trying fallback..."
    if curl -fsSL "$fallback_url" -o "$out_file"; then
        return 0
    fi

    return 1
}

# Download and install redeven
install_redeven() {
    log_info "Installing redeven..."

    # Create installation directory
    mkdir -p "$INSTALL_DIR"

    # Construct download URLs
    GITHUB_DOWNLOAD_URL="${GITHUB_RELEASES_URL}/download/${LATEST_VERSION}/${PACKAGE_NAME}"
    GITHUB_SUMS_URL="${GITHUB_RELEASES_URL}/download/${LATEST_VERSION}/SHA256SUMS"
    GITHUB_SIG_URL="${GITHUB_RELEASES_URL}/download/${LATEST_VERSION}/SHA256SUMS.sig"
    GITHUB_CERT_URL="${GITHUB_RELEASES_URL}/download/${LATEST_VERSION}/SHA256SUMS.pem"

    CLOUDFLARE_BASE_URL="https://agent.package.example.invalid/release-assets/${LATEST_VERSION}"
    CLOUDFLARE_DOWNLOAD_URL="${CLOUDFLARE_BASE_URL}/${PACKAGE_NAME}"
    CLOUDFLARE_SUMS_URL="${CLOUDFLARE_BASE_URL}/SHA256SUMS"
    CLOUDFLARE_SIG_URL="${CLOUDFLARE_BASE_URL}/SHA256SUMS.sig"
    CLOUDFLARE_CERT_URL="${CLOUDFLARE_BASE_URL}/SHA256SUMS.pem"

    # Create temporary directory
    TMP_DIR=$(mktemp -d)
    trap 'rm -rf "$TMP_DIR"' EXIT

    ARCHIVE_PATH="$TMP_DIR/redeven.tar.gz"
    SUMS_PATH="$TMP_DIR/SHA256SUMS"
    SIG_PATH="$TMP_DIR/SHA256SUMS.sig"
    CERT_PATH="$TMP_DIR/SHA256SUMS.pem"

    log_info "Downloading package from GitHub: $GITHUB_DOWNLOAD_URL"
    if ! download_with_fallback "$GITHUB_DOWNLOAD_URL" "$CLOUDFLARE_DOWNLOAD_URL" "$ARCHIVE_PATH"; then
        log_error "Failed to download release package"
        log_error "GitHub URL: $GITHUB_DOWNLOAD_URL"
        log_error "external delivery URL: $CLOUDFLARE_DOWNLOAD_URL"
        exit 1
    fi

    log_info "Downloading release checksums"
    if ! download_with_fallback "$GITHUB_SUMS_URL" "$CLOUDFLARE_SUMS_URL" "$SUMS_PATH"; then
        log_error "Failed to download SHA256SUMS"
        exit 1
    fi

    log_info "Downloading release signature"
    if ! download_with_fallback "$GITHUB_SIG_URL" "$CLOUDFLARE_SIG_URL" "$SIG_PATH"; then
        log_error "Failed to download SHA256SUMS.sig"
        exit 1
    fi

    log_info "Downloading release certificate"
    if ! download_with_fallback "$GITHUB_CERT_URL" "$CLOUDFLARE_CERT_URL" "$CERT_PATH"; then
        log_error "Failed to download SHA256SUMS.pem"
        exit 1
    fi

    verify_signature "$SUMS_PATH" "$SIG_PATH" "$CERT_PATH"
    verify_checksum "$SUMS_PATH" "$ARCHIVE_PATH"

    # Extract the binary
    log_info "Extracting binary..."
    # On some platforms (especially when archives are built on macOS),
    # tar may emit harmless warnings like:
    #   Ignoring unknown extended header keyword 'LIBARCHIVE.xattr.com.apple.provenance'
    # For Linux, try to suppress these with --warning=no-unknown-keyword.
    if [ "$OS" = "linux" ]; then
        if ! tar --warning=no-unknown-keyword -xzf "$ARCHIVE_PATH" -C "$TMP_DIR" 2>/dev/null; then
            # Fallback without the flag if tar does not support --warning
            if ! tar -xzf "$ARCHIVE_PATH" -C "$TMP_DIR"; then
                log_error "Failed to extract binary"
                exit 1
            fi
        fi
    else
        if ! tar -xzf "$ARCHIVE_PATH" -C "$TMP_DIR"; then
            log_error "Failed to extract binary"
            exit 1
        fi
    fi

    # Move binary to installation directory
    if [ -f "$TMP_DIR/$BINARY_NAME" ]; then
        # In forced install dir mode (agent self-upgrade), do not attempt sudo or interactive escalation; fail fast if not writable.
        if [ -n "${REDEVEN_INSTALL_DIR:-}" ] && [ ! -w "$INSTALL_DIR" ]; then
            log_error "Forced install directory is not writable: $INSTALL_DIR"
            log_error "Please reinstall the agent into a writable directory, or run the upgrade manually with appropriate permissions."
            exit 1
        fi

        # Check if we need sudo for installation
        if [ "$INSTALL_DIR" = "/usr/local/bin" ] && [ ! -w "$INSTALL_DIR" ]; then
            log_info "Installing to system directory (requires sudo)..."
            sudo mkdir -p "$INSTALL_DIR"
            sudo mv "$TMP_DIR/$BINARY_NAME" "$INSTALL_DIR/$BINARY_NAME"
            sudo chmod +x "$INSTALL_DIR/$BINARY_NAME"
        else
            mkdir -p "$INSTALL_DIR"
            mv "$TMP_DIR/$BINARY_NAME" "$INSTALL_DIR/$BINARY_NAME"
            chmod +x "$INSTALL_DIR/$BINARY_NAME"
        fi
        log_info "Binary installed to: $INSTALL_DIR/$BINARY_NAME"
    else
        log_error "Binary not found in archive"
        exit 1
    fi
}

cleanup_legacy_home() {
    # Dev-stage breaking change: remove legacy ~/.redeven-agent to avoid stale state surprises.
    if [ -n "${HOME:-}" ] && [ -e "${HOME}/.redeven-agent" ]; then
        log_info "Removing legacy directory: ${HOME}/.redeven-agent"
        rm -rf "${HOME}/.redeven-agent" 2>/dev/null || true
    fi
}

# Add installation directory to PATH if needed
setup_path() {
    log_info "Checking PATH configuration..."

    # Check if INSTALL_DIR is already in PATH
    case ":$PATH:" in
        *":$INSTALL_DIR:"*)
            log_info "✓ Installation directory is already in PATH"
            return 0
            ;;
    esac

    # If installed to system directory, it should already be in PATH
    if [ "$INSTALL_DIR" = "/usr/local/bin" ]; then
        log_info "✓ Installed to system directory (already in PATH)"
        return 0
    fi

    log_warn "Installation directory is not in PATH"
    log_info "Attempting to add to PATH automatically..."

    # Detect shell and corresponding config file
    SHELL_NAME=$(basename "$SHELL")
    SHELL_CONFIG=""

    case "$SHELL_NAME" in
        bash)
            # Try .bashrc first, then .bash_profile
            if [ -f "$HOME/.bashrc" ]; then
                SHELL_CONFIG="$HOME/.bashrc"
            elif [ -f "$HOME/.bash_profile" ]; then
                SHELL_CONFIG="$HOME/.bash_profile"
            else
                SHELL_CONFIG="$HOME/.bashrc"
            fi
            ;;
        zsh)
            SHELL_CONFIG="$HOME/.zshrc"
            ;;
        fish)
            SHELL_CONFIG="$HOME/.config/fish/config.fish"
            ;;
        *)
            SHELL_CONFIG="$HOME/.profile"
            ;;
    esac

    # PATH export line to add (append to PATH).
    PATH_EXPORT="export PATH=\"\$PATH:$INSTALL_DIR\""

    # Check if PATH is already configured in the shell config file
    if [ -f "$SHELL_CONFIG" ] && grep -q "$INSTALL_DIR" "$SHELL_CONFIG" 2>/dev/null; then
        log_info "PATH already configured in $SHELL_CONFIG"
        log_warn "Please restart your shell or run: source $SHELL_CONFIG"
        return 0
    fi

    # Add PATH to shell config file
    log_info "Adding PATH to $SHELL_CONFIG..."

    # Create config file if it doesn't exist
    touch "$SHELL_CONFIG"

    # Add PATH export with a comment
    {
        echo ""
        echo "# Added by Redeven agent installer"
        echo "$PATH_EXPORT"
    } >> "$SHELL_CONFIG"

    log_info "PATH successfully added to $SHELL_CONFIG"

    # Store the source command for later use in summary
    SOURCE_COMMAND="source $SHELL_CONFIG"
    export SOURCE_COMMAND

    # Try to make the binary available in current session
    # Note: This only works within the script's subprocess, not the parent shell
    export PATH="$PATH:$INSTALL_DIR"
}

# Print installation summary
print_summary() {
    echo ""
    log_info "============================================"
    log_info "Redeven CLI installed successfully!"
    log_info "============================================"
    echo ""
    log_info "Installation details:"
    log_info "  Binary: $INSTALL_DIR/$BINARY_NAME"
    log_info "  Version: $LATEST_VERSION"
    log_info "  Version source: $VERSION_SOURCE"
    echo ""

    # Test the binary immediately using full path
    log_info "Testing installation..."
    if "$INSTALL_DIR/$BINARY_NAME" version >/dev/null 2>&1; then
        log_info "✓ Binary is working correctly!"
    else
        log_warn "Binary test failed, but installation completed."
    fi
    echo ""

    # Check if binary is in PATH
    if command -v redeven >/dev/null 2>&1; then
        log_info "✓ 'redeven' command is ready to use in current session!"
        echo ""
        log_info "Try it now:"
        echo "  redeven version"
    else
        log_warn "PATH has been configured, but not yet active in this session."
        echo ""
        log_info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        log_info "To start using 'redeven' command immediately, run this:"
        echo ""

        # Detect shell and provide specific command
        SHELL_NAME=$(basename "$SHELL")
        ACTIVATE_CMD=""
        case "$SHELL_NAME" in
            bash)
                if [ -f "$HOME/.bashrc" ]; then
                    ACTIVATE_CMD="source ~/.bashrc"
                else
                    ACTIVATE_CMD="source ~/.bash_profile"
                fi
                ;;
            zsh)
                ACTIVATE_CMD="source ~/.zshrc"
                ;;
            fish)
                ACTIVATE_CMD="source ~/.config/fish/config.fish"
                ;;
            *)
                ACTIVATE_CMD="source ~/.profile"
                ;;
        esac

        # Print the command in a highlighted box
        echo "    ${GREEN}${ACTIVATE_CMD}${NC}"
        echo ""
        log_info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        log_info "Alternatively:"
        log_info "  • Open a new terminal window (PATH will be active automatically)"
        log_info "  • Use full path: $INSTALL_DIR/$BINARY_NAME"
    fi

    echo ""
    log_info "Next steps:"
    log_info "  1. Create an account at https://example.invalid"
    log_info "  2. Create a new environment in the dashboard"
    log_info "  3. Click \"Setup environment\" and run the setup commands"
    echo ""
    log_info "For more information, visit: https://example.invalid/docs"
    echo ""
}

# Main installation flow
main() {
    if [ "$REDEVEN_INSTALL_MODE" = "upgrade" ]; then
        log_info "Starting Redeven agent upgrade..."
    else
        log_info "Starting Redeven agent installation..."
    fi
    echo ""

    # Check environment
    check_environment

    # Remove legacy config/state directory (dev-stage breaking change)
    cleanup_legacy_home

    # Determine installation directory
    determine_install_dir

    # Detect platform
    detect_platform

    # Resolve version
    resolve_target_version

    # Install redeven
    install_redeven

    # Setup PATH + onboarding summary (skip in upgrade mode)
    if [ "$REDEVEN_INSTALL_MODE" != "upgrade" ]; then
        setup_path
        print_summary
    else
        log_info "Redeven agent upgraded successfully!"
        log_info "Binary: $INSTALL_DIR/$BINARY_NAME"
        log_info "Version: $LATEST_VERSION"
        log_info "Version source: $VERSION_SOURCE"
    fi
}

# Run main function
main
