package runtimepresentation

type BrandMarkSize string

const (
	BrandMarkCompact BrandMarkSize = "compact"
	BrandMarkTiny    BrandMarkSize = "tiny"
)

type BrandMark struct {
	Size       BrandMarkSize
	Lines      []string
	MinWidth   int
	MinHeight  int
	ANSIAccent bool
}

func CompactBrandMark() BrandMark {
	return BrandMark{
		Size:      BrandMarkCompact,
		Lines:     []string{"██", "██"},
		MinWidth:  2,
		MinHeight: 2,
	}
}

func TinyBrandMark() BrandMark {
	return BrandMark{
		Size:      BrandMarkTiny,
		Lines:     []string{"██"},
		MinWidth:  2,
		MinHeight: 1,
	}
}
