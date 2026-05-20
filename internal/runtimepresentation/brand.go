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
	return CompactBrandMarkFrame(0)
}

func CompactBrandMarkFrame(frame int) BrandMark {
	grid := []string{
		"011000000110",
		"001000000100",
		"111111111111",
		"100000000001",
		"100111000001",
		"100000000001",
		"100111111001",
		"100000000001",
		"111111111111",
		"111111111111",
	}
	if frame%2 == 1 {
		grid[4], grid[6] = grid[6], grid[4]
	}
	lines := quadrantBrandMark(grid)
	return BrandMark{
		Size:      BrandMarkCompact,
		Lines:     lines,
		MinWidth:  maxStringWidth(lines),
		MinHeight: len(lines),
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

func quadrantBrandMark(grid []string) []string {
	quadrants := map[int]rune{
		0x0: ' ',
		0x1: '▘',
		0x2: '▝',
		0x3: '▀',
		0x4: '▖',
		0x5: '▌',
		0x6: '▞',
		0x7: '▛',
		0x8: '▗',
		0x9: '▚',
		0xa: '▐',
		0xb: '▜',
		0xc: '▄',
		0xd: '▙',
		0xe: '▟',
		0xf: '█',
	}
	lines := make([]string, 0, (len(grid)+1)/2)
	for row := 0; row < len(grid); row += 2 {
		line := make([]rune, 0, len(grid[row])/2)
		for col := 0; col < len(grid[row]); col += 2 {
			mask := 0
			for dy := 0; dy < 2 && row+dy < len(grid); dy++ {
				for dx := 0; dx < 2 && col+dx < len(grid[row+dy]); dx++ {
					if grid[row+dy][col+dx] == '1' {
						mask |= 1 << (dy*2 + dx)
					}
				}
			}
			line = append(line, quadrants[mask])
		}
		lines = append(lines, string(line))
	}
	return lines
}

func maxStringWidth(lines []string) int {
	maxWidth := 0
	for _, line := range lines {
		width := len([]rune(line))
		if width > maxWidth {
			maxWidth = width
		}
	}
	return maxWidth
}
