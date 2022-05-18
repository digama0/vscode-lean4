import * as React from 'react'

import { EditorContext, RpcContext } from './contexts'
import { DocumentPosition } from './util'
import { CodeToken, CodeWithInfos, InfoPopup, InfoWithCtx, InteractiveDiagnostics_infoToInteractive, Lean_Widget_getGoToLocation, TaggedText } from './rpcInterface'
import { DetectHoverSpan, HoverState, WithTooltipOnHover } from './tooltips'
import { Location } from 'vscode-languageserver-protocol'

export interface InteractiveTextComponentProps<T> {
  pos: DocumentPosition
  fmt: TaggedText<T>
}

export interface InteractiveTagProps<T> extends InteractiveTextComponentProps<T> {
  tag: T
}

export interface InteractiveTaggedTextProps<T> extends InteractiveTextComponentProps<T> {
  InnerTagUi: (_: InteractiveTagProps<T>) => JSX.Element
}

/**
 * Core loop to display `TaggedText` objects. Invokes `InnerTagUi` on `tag` nodes in order to support
 * various embedded information such as `InfoTree`s and `Expr`s.
 * */
export function InteractiveTaggedText<T>({pos, fmt, InnerTagUi}: InteractiveTaggedTextProps<T>) {
  if ('text' in fmt) return <>{fmt.text}</>
  else if ('append' in fmt) return <>
    {fmt.append.map((a, i) => <InteractiveTaggedText key={i} pos={pos} fmt={a} InnerTagUi={InnerTagUi} />)}
  </>
  else if ('tag' in fmt) return <InnerTagUi pos={pos} fmt={fmt.tag[1]} tag={fmt.tag[0]} />
  else throw new Error(`malformed 'TaggedText': '${fmt}'`)
}

/** Shows `explicitValue : itsType` and a docstring if there is one. */
function TypePopupContents({pos, info, redrawTooltip}: {pos: DocumentPosition, info: InfoWithCtx, redrawTooltip: () => void}) {
  const rs = React.useContext(RpcContext)
  // When `err` is defined we show the error,
  // otherwise if `ip` is defined we show its contents,
  // otherwise a 'loading' message.
  const [ip, setIp] = React.useState<InfoPopup>()
  const [err, setErr] = React.useState<string>()

  React.useEffect(() => {
    InteractiveDiagnostics_infoToInteractive(rs, pos, info).then(val => {
      if (val) {
        setErr(undefined)
        setIp(val)
      }
    }).catch(ex => {
      if ('message' in ex) setErr('' + ex.message)
      else if ('code' in ex) setErr(`RPC error (${ex.code})`)
      else setErr(JSON.stringify(ex))
    })
  }, [rs, pos.uri, pos.line, pos.character, info])

  // We let the tooltip know to redo its layout whenever our contents change.
  React.useEffect(() => redrawTooltip(), [ip, err, redrawTooltip])

  if (err)
    return <>Error: {err}</>

  if (ip) {
    return <>
      {ip.exprExplicit && <InteractiveCode pos={pos} fmt={ip.exprExplicit} />} : {ip.type && <InteractiveCode pos={pos} fmt={ip.type} />}
      {ip.doc && <hr />}
      {ip.doc && ip.doc} {/* TODO markdown */}
    </>
  } else return <>Loading..</>
}

/** Tagged spans can be hovered over to display extra info stored in the associated `CodeToken`. */
function InteractiveCodeTag({pos, tag: ct, fmt}: InteractiveTagProps<CodeToken>) {
  const mkTooltip = React.useCallback((redrawTooltip: () => void) =>
    <div className="font-code tl pre-wrap">
      <TypePopupContents pos={pos} info={ct.info}
        redrawTooltip={redrawTooltip} />
    </div>, [pos.uri, pos.line, pos.character, ct.info])

  // We mimick the VSCode ctrl-hover and ctrl-click UI for go-to-definition
  const rs = React.useContext(RpcContext)
  const ec = React.useContext(EditorContext);
  const [goToLoc, setGoToLoc] = React.useState<Location | undefined>(undefined)
  const [hoverState, setHoverState] = React.useState<HoverState>('off')

  return (
    <WithTooltipOnHover mkTooltipContent={mkTooltip} onClick={(e, next) => {
      // On ctrl-click, if location is known, go to it in the editor
      if (e.ctrlKey && goToLoc !== undefined) ec.revealPosition({ uri: goToLoc.uri, ...goToLoc.range.start })
      if (!e.ctrlKey) next(e)
    }}>
      <DetectHoverSpan
        setHoverState={st => {
          // On ctrl-hover, fetch the go-to location
          if (st === 'ctrlOver') {
            void Lean_Widget_getGoToLocation(rs, pos, ct.info, 'definition').then(loc => {
              if (loc) setGoToLoc(loc)
            }).catch(e => console.error('Error in go-to-definition: ', e.toString()))
          }
          setHoverState(st)
        }}
        className={'highlightable '
                    + (hoverState !== 'off' ? 'highlight ' : '')
                    + (hoverState === 'ctrlOver' && goToLoc !== undefined ? 'underline ' : '')}
      >
        <InteractiveCode pos={pos} fmt={fmt} />
      </DetectHoverSpan>
    </WithTooltipOnHover>
  )
}

export function InteractiveCode({pos, fmt}: {pos: DocumentPosition, fmt: CodeWithInfos}) {
  return InteractiveTaggedText({pos, fmt, InnerTagUi: InteractiveCodeTag})
}
