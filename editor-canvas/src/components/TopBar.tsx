import React from 'react'
import { PageDropdown } from './PageDropdown'

interface Props {
  saveStatus: 'saved' | 'saving' | 'error'
}

export function TopBar({ saveStatus }: Props) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        left: 16,
        zIndex: 80,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        height: 32,
        padding: '0 10px 0 5px',
        backgroundColor: 'rgba(255, 255, 255, 0.92)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderRadius: 9999,
        border: '1px solid rgba(0, 0, 0, 0.08)',
        boxShadow: '0 8px 24px -4px rgba(0, 0, 0, 0.08), 0 2px 6px -1px rgba(0, 0, 0, 0.03)',
        userSelect: 'none',
      }}
    >
      {/* 画板名称下拉选择器 */}
      <PageDropdown />

      {/* 极简分隔点线 */}
      <div style={{ width: 1, height: 12, backgroundColor: '#e2e8f0', margin: '0 1px' }} />

      {/* 云端保存状态指示 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          paddingLeft: 3,
        }}
        title={saveStatus === 'saving' ? '正在保存到云端…' : saveStatus === 'error' ? '保存遇到异常' : '云端已实时同步'}
      >
        <div
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            backgroundColor: saveStatus === 'saving' ? '#f59e0b' : saveStatus === 'error' ? '#ef4444' : '#10b981',
            transition: 'background-color 200ms ease',
          }}
        />
        <span style={{ fontSize: 11, fontWeight: 500, color: '#64748b', letterSpacing: '-0.01em' }}>
          {saveStatus === 'saving' ? '保存中' : saveStatus === 'error' ? '保存失败' : '已保存'}
        </span>
      </div>
    </div>
  )
}
