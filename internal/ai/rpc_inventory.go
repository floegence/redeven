package ai

// RPCDirection distinguishes request handlers from server notifications.
type RPCDirection string

const (
	RPCDirectionRequest RPCDirection = "request"
	RPCDirectionNotify  RPCDirection = "notify"
)

// RPCMethodContract is the canonical inventory for the AI RPC domain.
// Production session assembly and protocol parity tests consume this list so a
// declared capability cannot silently omit its server handler.
type RPCMethodContract struct {
	Method    string
	TypeID    uint32
	Direction RPCDirection
}

// RPCMethodInventory returns an immutable copy of the AI RPC contract.
func RPCMethodInventory() []RPCMethodContract {
	return []RPCMethodContract{
		{Method: "sendUserTurn", TypeID: TypeID_AI_SEND_USER_TURN, Direction: RPCDirectionRequest},
		{Method: "subscribeSummary", TypeID: TypeID_AI_SUBSCRIBE_SUMMARY, Direction: RPCDirectionRequest},
		{Method: "event", TypeID: TypeID_AI_EVENT_NOTIFY, Direction: RPCDirectionNotify},
		{Method: "listMessages", TypeID: TypeID_AI_MESSAGES_LIST, Direction: RPCDirectionRequest},
		{Method: "subscribeThread", TypeID: TypeID_AI_SUBSCRIBE_THREAD, Direction: RPCDirectionRequest},
		{Method: "stopThread", TypeID: TypeID_AI_STOP_THREAD, Direction: RPCDirectionRequest},
		{Method: "submitRequestUserInputResponse", TypeID: TypeID_AI_SUBMIT_REQUEST_USER_INPUT_RESPONSE, Direction: RPCDirectionRequest},
		{Method: "compactThreadContext", TypeID: TypeID_AI_COMPACT_THREAD_CONTEXT, Direction: RPCDirectionRequest},
	}
}
