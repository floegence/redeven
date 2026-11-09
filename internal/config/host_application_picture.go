package config

import "errors"

// HostApplicationPicture is the Env user's persisted viewer preference. Native
// and Xpra viewers consume the same record; backend capabilities limit output.
type HostApplicationPicture struct {
	Mode         string `json:"mode"`
	MaxDimension int    `json:"max_dimension"`
	FrameRate    int    `json:"frame_rate"`
}

func (p HostApplicationPicture) Validate() error {
	if p.Mode != "auto" && p.Mode != "clarity" && p.Mode != "smooth" && p.Mode != "data" {
		return errors.New("invalid host application picture mode")
	}
	validDimension := false
	for _, value := range []int{0, 1600, 1920, 2560, 3840, 4096} {
		validDimension = validDimension || p.MaxDimension == value
	}
	validRate := false
	for _, value := range []int{0, 15, 24, 30, 60} {
		validRate = validRate || p.FrameRate == value
	}
	if !validDimension || !validRate {
		return errors.New("invalid host application picture limits")
	}
	return nil
}
