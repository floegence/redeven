import AppKit
import ApplicationServices
import CryptoKit

func nativeSourcePage(_ value: Any, identity: String, args: [String: Any], metadata: [String: Any]) throws -> [String: Any] {
    let encoding = value is String ? "text" : "json"
    let full: String
    if let text = value as? String { full = text }
    else { full = String(data: try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .sortedKeys]), encoding: .utf8)! }
    let scalars = Array(full.unicodeScalars)
    let digest = SHA256.hash(data: Data((identity + full).utf8)).map { String(format:"%02x",$0) }.joined()
    var offset = 0
    if let cursor = args["cursor"] as? String {
        let parts = cursor.split(separator: ":")
        guard parts.count == 2, String(parts[0]) == digest, let number = Int(parts[1]), number >= 0, number <= scalars.count else { throw HostFailure(code:"STALE_REFERENCE", message:"Source content changed; read it again.") }
        offset = number
    }
    let limit = args["limit"] as? Int ?? 12000
    guard limit > 0, limit <= 12000 else { throw NativeInput.invalid("Source limit must be 1 to 12000.") }
    var end=offset,bytes=0
    while end<scalars.count && end-offset<limit {
        let encoded=try JSONSerialization.data(withJSONObject:String(scalars[end]),options:[.fragmentsAllowed])
        if bytes+encoded.count>48000 {break};bytes+=encoded.count;end+=1
    }
    var result = metadata
    result.merge(["value":String(String.UnicodeScalarView(scalars[offset..<end])), "encoding":encoding,"offset":offset,"total":scalars.count,"unit":"unicode_code_points","truncated":end < scalars.count]) { _,new in new }
    if end < scalars.count { result["next_cursor"] = digest + ":" + String(end) }
    return result
}

extension NativeWindow {
    func sourceValue(_ raw: Any, depth: Int = 0) throws -> Any {
        guard depth < 16 else { throw HostFailure(code:"TARGET_CAPABILITY_UNAVAILABLE",message:"Source value nesting exceeds serialization support.") }
        let cf = raw as CFTypeRef
        if CFGetTypeID(cf) == AXUIElementGetTypeID() {
            let node = unsafeBitCast(cf, to: AXUIElement.self)
            guard contains(node) else { return ["available":false,"reason":"outside_target"] }
            return ["ref":describe(node)["ref"]!]
        }
        if CFGetTypeID(cf) == AXValueGetTypeID() {
            let value=unsafeBitCast(cf,to:AXValue.self)
            switch AXValueGetType(value) {
            case .cfRange: var r=CFRange(); guard AXValueGetValue(value,.cfRange,&r) else {throw NativeInput.unavailable()};return ["location":r.location,"length":r.length,"unit":"utf16_code_units"]
            case .cgPoint: var p=CGPoint.zero;guard AXValueGetValue(value,.cgPoint,&p) else {throw NativeInput.unavailable()};return ["x":p.x,"y":p.y]
            case .cgSize: var s=CGSize.zero;guard AXValueGetValue(value,.cgSize,&s) else {throw NativeInput.unavailable()};return ["width":s.width,"height":s.height]
            case .cgRect: var r=CGRect.zero;guard AXValueGetValue(value,.cgRect,&r) else {throw NativeInput.unavailable()};return ["x":r.minX,"y":r.minY,"width":r.width,"height":r.height]
            default:return ["available":false,"reason":"unsupported_value_type"]
            }
        }
        if let values=raw as? [Any] {return try values.map{try sourceValue($0,depth:depth+1)}}
        if let value=raw as? NSAttributedString {return value.string}
        if let value=raw as? URL {
            var parts=URLComponents(url:value,resolvingAgainstBaseURL:false)
            parts?.user=nil;parts?.password=nil
            return parts?.string ?? value.absoluteString
        }
        if raw is String || raw is NSNumber || raw is NSNull {return raw}
        return ["available":false,"reason":"unsupported_value_type"]
    }
    func source(_ args:[String:Any]) throws -> [String:Any] {
        guard args["source"] == nil || args["source"] as? String == "ax", let selector=args["selector"] as? [String:Any] else {throw HostFailure(code:"TARGET_CAPABILITY_UNAVAILABLE",message:"Native targets expose AX source details.")}
        let node=try resolve(selector)
        var names:CFArray?,actions:CFArray?,parameters:CFArray?
        guard AXUIElementCopyAttributeNames(node,&names) == .success else {throw NativeInput.unavailable()}
        AXUIElementCopyActionNames(node,&actions);AXUIElementCopyParameterizedAttributeNames(node,&parameters)
        let metadata:[String:Any] = ["source":"macos_accessibility","document_id":"\(id):\(revision)","ref":describe(node)["ref"]!]
        guard let field=args["field"] as? String else {return metadata.merging(["fields":(names as? [String] ?? [])+["actions"],"parameterized_fields":parameters as? [String] ?? [],"truncated":false]){_,new in new}}
        var raw:CFTypeRef?
        let status:AXError
        if field == "actions" {raw=actions;status = .success}
        else if field.hasPrefix("parameterized:") {
            let name=String(field.dropFirst(14))
            guard (parameters as? [String] ?? []).contains(name),let range=args["parameter"] as? [String:Int],let location=range["location"],let length=range["length"],location>=0,length>=0 else {throw NativeInput.invalid("A supported parameterized attribute and range are required.")}
            var rangeValue=CFRange(location:location,length:length)
            guard let parameter=AXValueCreate(.cfRange,&rangeValue) else {throw NativeInput.unavailable()}
            status=AXUIElementCopyParameterizedAttributeValue(node,name as CFString,parameter,&raw)
        } else {status=AXUIElementCopyAttributeValue(node,field as CFString,&raw)}
        if status == .attributeUnsupported || status == .parameterizedAttributeUnsupported || status == .noValue {return metadata.merging(["field":field,"available":false,"reason":status == .noValue ? "no_value":"unsupported","truncated":false]){_,new in new}}
        guard status == .success,let raw else {throw NativeInput.unavailable()}
        if let values=raw as? [Any],values.allSatisfy({CFGetTypeID($0 as CFTypeRef)==AXUIElementGetTypeID()}) {
            let identity="\(id):\(revision):\(describe(node)["ref"]!):\(field)"
            let hashes=values.map{String(CFHash($0 as CFTypeRef))}.joined(separator:",")
            let digest=SHA256.hash(data:Data((identity+hashes).utf8)).map{String(format:"%02x",$0)}.joined()
            var offset=0
            if let cursor=args["cursor"] as? String {
                let parts=cursor.split(separator:":")
                guard parts.count==2,String(parts[0])==digest,let number=Int(parts[1]),number>=0,number<=values.count else {throw HostFailure(code:"STALE_REFERENCE",message:"Source collection changed.")}
                offset=number
            }
            let limit=args["limit"] as? Int ?? 100
            guard (1...12000).contains(limit) else {throw NativeInput.invalid("Invalid source limit.")}
            let end=min(values.count,offset+min(limit,200))
            var result=metadata
            result.merge(["field":field,"available":true,"items":try values[offset..<end].map{try sourceValue($0)},"offset":offset,"total":values.count,"unit":"items","truncated":end<values.count]){_,new in new}
            if end<values.count {result["next_cursor"]=digest+":"+String(end)}
            return result
        }
        return try nativeSourcePage(sourceValue(raw),identity:"\(id):\(revision):\(describe(node)["ref"]!):\(field)",args:args,metadata:metadata.merging(["field":field,"available":true]){_,new in new})
    }
    func selection(_ node:AXUIElement) throws -> [String:Any] {
        guard let raw=axValue(node,kAXSelectedTextRangeAttribute),CFGetTypeID(raw)==AXValueGetTypeID() else {throw HostFailure(code:"TARGET_CAPABILITY_UNAVAILABLE",message:"This control does not expose a selection range.")}
        var range=CFRange();guard AXValueGetValue(unsafeBitCast(raw,to:AXValue.self),.cfRange,&range) else {throw NativeInput.unavailable()}
        return ["start":range.location,"end":range.location+range.length,"text":axString(node,kAXSelectedTextAttribute),"unit":"utf16_code_units","ref":describe(node)["ref"]!]
    }
    func select(_ node:AXUIElement,args:[String:Any],willMutate:() throws -> Void) throws -> [String:Any] {
        guard args["direction"] == nil || args["direction"] as? String == "none" else {
            throw HostFailure(code:"TARGET_CAPABILITY_UNAVAILABLE",message:"AX ranges do not expose selection direction; omit direction or use none.")
        }
        let action=args["action"] as? String ?? "",full=axString(node,kAXValueAttribute) as NSString
        var range=NSRange(location:0,length:full.length)
        if action=="select_text" {
            guard let text=args["text"] as? String,!text.isEmpty else {throw NativeInput.invalid("Non-empty selection text is required.")}
            var matches:[NSRange]=[],offset=0
            while offset<=full.length {
                let found=full.range(of:text,range:NSRange(location:offset,length:full.length-offset));if found.location==NSNotFound {break}
                let prefix=args["prefix"] as? String,suffix=args["suffix"] as? String
                if (prefix==nil || full.substring(to:found.location).hasSuffix(prefix!)) && (suffix==nil || full.substring(from:NSMaxRange(found)).hasPrefix(suffix!)) {matches.append(found)}
                offset=NSMaxRange(found)
            }
            guard matches.count==1 else {throw HostFailure(code:matches.isEmpty ? "ELEMENT_NOT_FOUND":"AMBIGUOUS_ELEMENT",message:"Text selection must match exactly once.")}
            range=matches[0]
            if args["selection_type"] as? String=="cursor_before" {range.length=0}
            if args["selection_type"] as? String=="cursor_after" {range.location=NSMaxRange(range);range.length=0}
        }else if action=="select_range" {
            guard let start=args["start"] as? Int,let end=args["end"] as? Int,start>=0,end>=start,end<=full.length else {throw NativeInput.invalid("Invalid UTF-16 selection range.")}
            range=NSRange(location:start,length:end-start)
        }
        for boundary in [range.location,NSMaxRange(range)] where boundary>0 && boundary<full.length {
            if (0xD800...0xDBFF).contains(full.character(at:boundary-1)) && (0xDC00...0xDFFF).contains(full.character(at:boundary)) {throw NativeInput.invalid("A range cannot split a Unicode surrogate pair.")}
        }
        var writable=DarwinBoolean(false)
        guard AXUIElementIsAttributeSettable(node,kAXSelectedTextRangeAttribute as CFString,&writable) == .success,writable.boolValue else {throw HostFailure(code:"TARGET_CAPABILITY_UNAVAILABLE",message:"This control does not support setting its selection.")}
        var cf=CFRange(location:range.location,length:range.length)
        guard let value=AXValueCreate(.cfRange,&cf) else {throw NativeInput.unavailable()}
        try willMutate()
        guard AXUIElementSetAttributeValue(node,kAXSelectedTextRangeAttribute as CFString,value) == .success else {throw HostFailure(code:"EFFECT_OUTCOME_UNKNOWN",message:"Selection was not confirmed.")}
        return ["action_executed":true,"selection":try selection(node),"mechanism":"accessibility"]
    }
}
