#!/bin/sh
# Redeven CLI Installation Script
#
# This script downloads and installs the latest Redeven runtime binary
# from the floegence/redeven GitHub repository.
#
# Usage: curl -fsSL https://raw.githubusercontent.com/floegence/redeven/main/scripts/install.sh | sh
#
# Optional:
#   REDEVEN_VERSION=v1.2.3 curl -fsSL https://raw.githubusercontent.com/floegence/redeven/main/scripts/install.sh | sh
#
# The script will:
# 1. Detect your OS and architecture
# 2. Resolve target version from the GitHub Releases API
#    (or REDEVEN_VERSION when explicitly provided)
# 3. Download the release package and release checksums from GitHub Releases
# 4. Verify checksum + signature before extraction
# 5. Install to /usr/local/bin/redeven (or ~/.redeven/bin/redeven)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# GitHub repository for releases
GITHUB_REPO="floegence/redeven"
GITHUB_RELEASES_URL="https://github.com/${GITHUB_REPO}/releases"
GITHUB_API_URL="https://api.github.com/repos/${GITHUB_REPO}"

# Binary name
BINARY_NAME="redeven"

# Public URL templates.
REDEVEN_RELEASES_API_URL="${REDEVEN_RELEASES_API_URL:-${GITHUB_API_URL}/releases/latest}"
REDEVEN_CONSOLE_URL="${REDEVEN_CONSOLE_URL:-https://console.example.invalid}"
REDEVEN_DOCS_URL="${REDEVEN_DOCS_URL:-https://docs.example.invalid}"

# Shell-first tooling: pinned ripgrep distribution.
RG_VERSION="14.1.1"
RG_GITHUB_RELEASES_URL="https://github.com/BurntSushi/ripgrep/releases"

# Redeven home directory - default runtime state lives under ~/.redeven/local-environment/
REDEVEN_HOME="${HOME}/.redeven"
REDEVEN_TOOLS_DIR="${REDEVEN_HOME}/tools"

# Install mode:
# - install (default): install flow (configure PATH, print onboarding)
# - upgrade: upgrade-only flow (skip PATH changes and onboarding)
REDEVEN_INSTALL_MODE="${REDEVEN_INSTALL_MODE:-install}"

# Optional explicit target version (for deterministic install/rollback)
REDEVEN_VERSION="${REDEVEN_VERSION:-}"

# Cosign identity constraint for SHA256SUMS signature verification.
COSIGN_CERT_IDENTITY_REGEXP='^https://github.com/floegence/redeven/.github/workflows/release\.yml@refs/tags/v.*$'
COSIGN_CERT_OIDC_ISSUER='https://token.actions.githubusercontent.com'

# Installation directories
INSTALL_DIR="${REDEVEN_HOME}/bin"
RG_TARGET=""
RG_ARCHIVE_NAME=""
RG_EXPECTED_SHA256=""

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

    # Forced install directory: used for runtime self-upgrade to ensure we overwrite the currently running binary path.
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
            log_error "Please use WSL (Windows Subsystem for Linux) to run Redeven runtime."
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

    case "${OS}_${ARCH}" in
        linux_amd64)
            RG_TARGET="x86_64-unknown-linux-musl"
            ;;
        linux_arm64)
            RG_TARGET="aarch64-unknown-linux-gnu"
            ;;
        linux_arm)
            RG_TARGET="armv7-unknown-linux-musleabihf"
            ;;
        linux_386)
            RG_TARGET="i686-unknown-linux-gnu"
            ;;
        darwin_amd64)
            RG_TARGET="x86_64-apple-darwin"
            ;;
        darwin_arm64)
            RG_TARGET="aarch64-apple-darwin"
            ;;
        *)
            log_error "Unsupported platform for ripgrep: ${OS}_${ARCH}"
            exit 1
            ;;
    esac

    RG_ARCHIVE_NAME="ripgrep-${RG_VERSION}-${RG_TARGET}.tar.gz"
    if ! RG_EXPECTED_SHA256=$(resolve_rg_sha256 "$RG_TARGET"); then
        log_error "No pinned checksum configured for ripgrep target: $RG_TARGET"
        exit 1
    fi

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

    resolve_version_from_github
}

resolve_version_from_github() {
    log_info "Resolving latest release from GitHub: $REDEVEN_RELEASES_API_URL"

    if ! response="$(curl -fsSL "$REDEVEN_RELEASES_API_URL")"; then
        log_error "Failed to resolve the latest release from GitHub"
        log_error "If GitHub API access is unavailable, set REDEVEN_VERSION explicitly."
        exit 1
    fi

    compact_response=$(printf '%s' "$response" | tr -d '\n')
    LATEST_VERSION=$(printf '%s' "$compact_response" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
    if [ -z "$LATEST_VERSION" ] || ! validate_release_version "$LATEST_VERSION"; then
        log_error "GitHub Releases API did not return a valid tag_name"
        log_error "If needed, set REDEVEN_VERSION explicitly."
        exit 1
    fi

    VERSION_SOURCE="github_latest_release"
    log_info "Resolved latest version: $LATEST_VERSION"
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

resolve_rg_sha256() {
    case "$1" in
        x86_64-unknown-linux-musl)
            printf '%s\n' '4cf9f2741e6c465ffdb7c26f38056a59e2a2544b51f7cc128ef28337eeae4d8e'
            ;;
        aarch64-unknown-linux-gnu)
            printf '%s\n' 'c827481c4ff4ea10c9dc7a4022c8de5db34a5737cb74484d62eb94a95841ab2f'
            ;;
        armv7-unknown-linux-musleabihf)
            printf '%s\n' 'ec568e3c82054933cf22eced8eaffc1c93d38efcd505cb04df905f95e85d03a6'
            ;;
        i686-unknown-linux-gnu)
            printf '%s\n' '2ce1beccb27ce9ad8e26593be52b15e8da0ee7bf3e0e59d5553ab3333a087a4e'
            ;;
        x86_64-apple-darwin)
            printf '%s\n' 'fc87e78f7cb3fea12d69072e7ef3b21509754717b746368fd40d88963630e2b3'
            ;;
        aarch64-apple-darwin)
            printf '%s\n' '24ad76777745fbff131c8fbc466742b011f925bfa4fffa2ded6def23b5b937be'
            ;;
        *)
            return 1
            ;;
    esac
}

verify_pinned_checksum() {
    expected="$1"
    archive_file="$2"
    label="$3"

    actual=$(sha256_file "$archive_file" | tr -d '\r\n')

    if [ "$actual" != "$expected" ]; then
        log_error "Checksum mismatch for $label"
        log_error "Expected: $expected"
        log_error "Actual:   $actual"
        exit 1
    fi
    log_info "Checksum verification passed for $label"
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

download_file() {
    source_url="$1"
    out_file="$2"

    curl -fsSL "$source_url" -o "$out_file"
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

    # Create temporary directory
    TMP_DIR=$(mktemp -d)
    trap 'rm -rf "$TMP_DIR"' EXIT

    ARCHIVE_PATH="$TMP_DIR/redeven.tar.gz"
    SUMS_PATH="$TMP_DIR/SHA256SUMS"
    SIG_PATH="$TMP_DIR/SHA256SUMS.sig"
    CERT_PATH="$TMP_DIR/SHA256SUMS.pem"

    log_info "Downloading package from GitHub: $GITHUB_DOWNLOAD_URL"
    if ! download_file "$GITHUB_DOWNLOAD_URL" "$ARCHIVE_PATH"; then
        log_error "Failed to download release package"
        log_error "GitHub URL: $GITHUB_DOWNLOAD_URL"
        exit 1
    fi

    log_info "Downloading release checksums"
    if ! download_file "$GITHUB_SUMS_URL" "$SUMS_PATH"; then
        log_error "Failed to download SHA256SUMS"
        exit 1
    fi

    log_info "Downloading release signature"
    if ! download_file "$GITHUB_SIG_URL" "$SIG_PATH"; then
        log_error "Failed to download SHA256SUMS.sig"
        exit 1
    fi

    log_info "Downloading release certificate"
    if ! download_file "$GITHUB_CERT_URL" "$CERT_PATH"; then
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
        # In forced install dir mode (runtime self-upgrade), do not attempt sudo or interactive escalation; fail fast if not writable.
        if [ -n "${REDEVEN_INSTALL_DIR:-}" ] && [ ! -w "$INSTALL_DIR" ]; then
            log_error "Forced install directory is not writable: $INSTALL_DIR"
            log_error "Please reinstall Redeven into a writable directory, or run the upgrade manually with appropriate permissions."
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

install_ripgrep() {
    log_info "Installing ripgrep ${RG_VERSION}..."

    if [ -z "$RG_TARGET" ] || [ -z "$RG_ARCHIVE_NAME" ] || [ -z "$RG_EXPECTED_SHA256" ]; then
        log_error "ripgrep target metadata is missing"
        exit 1
    fi

    RG_GITHUB_URL="${RG_GITHUB_RELEASES_URL}/download/${RG_VERSION}/${RG_ARCHIVE_NAME}"
    RG_TMP_DIR=$(mktemp -d)
    RG_ARCHIVE_PATH="${RG_TMP_DIR}/${RG_ARCHIVE_NAME}"

    log_info "Downloading ripgrep package from GitHub: $RG_GITHUB_URL"
    if ! download_file "$RG_GITHUB_URL" "$RG_ARCHIVE_PATH"; then
        log_error "Failed to download ripgrep package"
        log_error "GitHub URL: $RG_GITHUB_URL"
        rm -rf "$RG_TMP_DIR"
        exit 1
    fi

    verify_pinned_checksum "$RG_EXPECTED_SHA256" "$RG_ARCHIVE_PATH" "$RG_ARCHIVE_NAME"

    if [ "$OS" = "linux" ]; then
        if ! tar --warning=no-unknown-keyword -xzf "$RG_ARCHIVE_PATH" -C "$RG_TMP_DIR" 2>/dev/null; then
            if ! tar -xzf "$RG_ARCHIVE_PATH" -C "$RG_TMP_DIR"; then
                log_error "Failed to extract ripgrep package"
                rm -rf "$RG_TMP_DIR"
                exit 1
            fi
        fi
    else
        if ! tar -xzf "$RG_ARCHIVE_PATH" -C "$RG_TMP_DIR"; then
            log_error "Failed to extract ripgrep package"
            rm -rf "$RG_TMP_DIR"
            exit 1
        fi
    fi

    RG_EXTRACTED_BINARY="${RG_TMP_DIR}/ripgrep-${RG_VERSION}-${RG_TARGET}/rg"
    if [ ! -f "$RG_EXTRACTED_BINARY" ]; then
        log_error "ripgrep binary not found in package"
        rm -rf "$RG_TMP_DIR"
        exit 1
    fi

    RG_VERSION_DIR="${REDEVEN_TOOLS_DIR}/rg/${RG_VERSION}/${RG_TARGET}"
    RG_BINARY_PATH="${RG_VERSION_DIR}/rg"
    RG_LINK_PATH="${REDEVEN_HOME}/bin/rg"

    mkdir -p "$RG_VERSION_DIR"
    mkdir -p "${REDEVEN_HOME}/bin"
    cp "$RG_EXTRACTED_BINARY" "$RG_BINARY_PATH"
    chmod +x "$RG_BINARY_PATH"
    ln -sf "$RG_BINARY_PATH" "$RG_LINK_PATH"

    rm -rf "$RG_TMP_DIR"

    log_info "ripgrep installed to: $RG_BINARY_PATH"
    log_info "ripgrep symlink updated: $RG_LINK_PATH"
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
        echo "# Added by Redeven installer"
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
    log_info "  ripgrep: ${REDEVEN_HOME}/bin/rg (v${RG_VERSION})"
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
    log_info "  1. Create an account at ${REDEVEN_CONSOLE_URL}"
    log_info "  2. Create a new environment in the dashboard"
    log_info "  3. Click \"Setup environment\" and run the setup commands"
    echo ""
    log_info "For more information, visit: ${REDEVEN_DOCS_URL}"
    echo ""
}

# Main installation flow
main() {
    if [ "$REDEVEN_INSTALL_MODE" = "upgrade" ]; then
        log_info "Starting Redeven upgrade..."
    else
        log_info "Starting Redeven installation..."
    fi
    echo ""

    # Check environment
    check_environment

    # Determine installation directory
    determine_install_dir

    # Detect platform
    detect_platform

    # Resolve version
    resolve_target_version

    # Install redeven
    install_redeven

    # Install pinned ripgrep used by shell-first AI workflow
    install_ripgrep

    # Setup PATH + onboarding summary (skip in upgrade mode)
    if [ "$REDEVEN_INSTALL_MODE" != "upgrade" ]; then
        setup_path
        print_summary
    else
        log_info "Redeven upgraded successfully!"
        log_info "Binary: $INSTALL_DIR/$BINARY_NAME"
        log_info "Version: $LATEST_VERSION"
        log_info "Version source: $VERSION_SOURCE"
        log_info "ripgrep: ${REDEVEN_HOME}/bin/rg (v${RG_VERSION})"
    fi
}

# Run main function
main
