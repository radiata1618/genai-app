"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { usePathname } from "next/navigation";

const SidebarContext = createContext({
    isSidebarOpen: false,
    toggleSidebar: () => { },
    closeSidebar: () => { },
    isAgentSidebarOpen: false,
    toggleAgentSidebar: () => { },
    closeAgentSidebar: () => { },
    openAgentSidebar: () => { },
});

export const SidebarProvider = ({ children }) => {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isAgentSidebarOpen, setIsAgentSidebarOpen] = useState(false);
    const pathname = usePathname();

    const toggleSidebar = () => setIsSidebarOpen(prev => !prev);
    const closeSidebar = () => setIsSidebarOpen(false);

    const toggleAgentSidebar = () => setIsAgentSidebarOpen(prev => !prev);
    const closeAgentSidebar = () => setIsAgentSidebarOpen(false);
    const openAgentSidebar = () => setIsAgentSidebarOpen(true);

    // Close sidebars on route change
    useEffect(() => {
        setIsSidebarOpen(false);
        setIsAgentSidebarOpen(false);
    }, [pathname]);

    return (
        <SidebarContext.Provider value={{ 
            isSidebarOpen, 
            toggleSidebar, 
            closeSidebar,
            isAgentSidebarOpen,
            toggleAgentSidebar,
            closeAgentSidebar,
            openAgentSidebar
        }}>
            {children}
        </SidebarContext.Provider>
    );
};

export const useSidebar = () => useContext(SidebarContext);
