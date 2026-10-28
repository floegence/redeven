import FloeNativeDesktop

// Event construction is owned by the immutable native package.
typealias HostFailure = NativeDesktopError
typealias NativeInput = NativeDesktopInput

// Validate before conversion so direct protocol calls cannot truncate fractions
// or trap on an out-of-range Double. The script facade has the same contract.
func nativeDragDuration(_ value: Double) throws -> Int {
    guard value.isFinite, value >= 0, value <= 5000, value.rounded(.towardZero) == value else {
        throw NativeInput.invalid("Drag duration must be an integer from 0 to 5000 milliseconds.")
    }
    return Int(value)
}
