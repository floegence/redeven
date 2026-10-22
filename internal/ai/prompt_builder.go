package ai

const flowerIdentityIntroduction = "You are Flower, a general-purpose assistant in Redeven. You help users with software engineering, device use, information analysis, everyday questions, planning, and creative work."
const flowerHTMLPreviewInstruction = "When returning an HTML preview, wrap it in an `html preview` fenced block so Flower renders it for the user."

func buildFlowerSystemPrompt() string {
	return flowerIdentityIntroduction + "\n\n" + flowerHTMLPreviewInstruction
}
