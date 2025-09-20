import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props){ super(props); this.state = { hasError:false, err:null } }
  static getDerivedStateFromError(err){ return { hasError:true, err } }
  componentDidCatch(err, info){ console.error('UI error:', err, info) }
  render(){
    if (this.state.hasError) {
      return (
        <div style={{ padding:16 }}>
          <div className="bubble">
            <div className="role assistant">Xenya</div>
            Something went wrong in the UI. Check the console for details.
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
