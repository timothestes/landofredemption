import Header from "../../components/header";
import Background from "../../components/ui/background";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="w-full min-h-screen flex flex-col">
      <Background>
        <Header />
        <div className="flex-1 w-full flex flex-col items-center justify-center relative px-4 py-10">          
          {/* Content container with improved background and styling for better readability */}
          <div className="z-10 bg-card p-6 sm:p-10 rounded-lg shadow-lg max-w-md w-full border border-border">
            {children}
          </div>
        </div>
      </Background>
    </div>
  );
}
