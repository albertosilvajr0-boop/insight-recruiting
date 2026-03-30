import { useNavigate } from 'react-router-dom'
export default function ThankYou() {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-2xl border border-gray-200 p-10 text-center space-y-5">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Application submitted!</h1>
        <p className="text-gray-500 text-sm">We'll review your application and be in touch within 1 business day.</p>
        <button onClick={() => navigate('/')} className="text-sm text-gray-500 hover:text-gray-700 underline">View other open positions</button>
      </div>
    </div>
  )
}
