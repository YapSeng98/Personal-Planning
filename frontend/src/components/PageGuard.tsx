import { Component, type ReactNode } from 'react'
import { useLang } from '../lib/i18n'

// A page that fails to draw (bad data from an old version, a bug) used to
// take the whole app down to an empty wallpaper — nav and all. Now only the
// page is replaced by this card; the menu still works, and going to another
// page (or Try again) draws it afresh. Nothing is lost: the data is untouched.
function Crashed({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { t } = useLang()
  return (
    <div className="card crash-card" role="alert">
      <h2>{t('app.crash')}</h2>
      <p className="muted">{t('app.crashHint')}</p>
      <code className="crash-msg">{error.message}</code>
      <div className="row">
        <button type="button" className="btn" onClick={onRetry}>{t('app.retry')}</button>
        <button type="button" className="btn btn-primary" onClick={() => location.reload()}>{t('app.reload')}</button>
      </div>
    </div>
  )
}

interface Props { page: string; children: ReactNode }
interface State { error: Error | null; page: string }

export default class PageGuard extends Component<Props, State> {
  state: State = { error: null, page: this.props.page }
  static getDerivedStateFromError(error: Error) { return { error } }
  // another page: draw it afresh
  static getDerivedStateFromProps(props: Props, state: State) {
    return props.page !== state.page ? { error: null, page: props.page } : null
  }
  componentDidCatch(error: Error) { console.error('[page]', error) }
  render() {
    const { error } = this.state
    return error ? <Crashed error={error} onRetry={() => this.setState({ error: null })} /> : this.props.children
  }
}
